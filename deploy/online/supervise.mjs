#!/usr/bin/env node
/*
 * Sensebod Offline, ONLINE TEST SERVER only: the container's main process.
 * On a Pi, systemd does this job (boot-recover, api, worker, maint timer, nginx); this file
 * is never installed there.
 *
 *   node supervise.mjs              start everything (the image's default command)
 *   node supervise.mjs reset-demo   wipe the data and start again from the demo lessons
 *                                   (run inside the running container: docker compose exec ...)
 *
 * On start it
 *   1. writes the backend configuration from environment variables (nothing secret in the repo);
 *   2. on the first start (no database yet) creates the bag with the demo lessons;
 *   3. runs boot recovery, as the Pi does once per boot;
 *   4. creates the staff account from SENSEBOD_ADMIN_USERNAME / SENSEBOD_ADMIN_PASSWORD if it
 *      does not exist yet (the password is passed on standard input, never on a command line);
 *   5. starts nginx, the API and the worker, restarts them if they stop, and runs maintenance
 *      1 minute after start and then every 15 minutes, like the Pi's timer.
 *
 * Environment (see docs/DEPLOY-ONLINE-DEMO.md):
 *   SENSEBOD_PUBLIC_HOST          the site's host name(s), comma-separated, e.g. sensebod-test.fly.dev
 *   SENSEBOD_ADMIN_USERNAME       staff account to create (optional)
 *   SENSEBOD_ADMIN_PASSWORD       its password, 10+ characters (or SENSEBOD_ADMIN_PASSWORD_FILE)
 *   SENSEBOD_ADMIN_DISPLAY_NAME   optional
 *   SENSEBOD_BASIC_AUTH_USER      optional: one password in front of the whole site
 *   SENSEBOD_BASIC_AUTH_PASSWORD  (or SENSEBOD_BASIC_AUTH_PASSWORD_FILE)
 *   SENSEBOD_COOKIE_SECURE        "1" (default): staff cookie only over HTTPS. "0" for plain-HTTP tests
 *   SENSEBOD_BACKUP_RECIPIENTS    optional: an age public key, so encrypted backups can be tested
 *   SENSEBOD_BAG_NAME             optional, default "Online test server"
 *   PORT                          port nginx listens on inside the container, default 8080
 */
import { execFileSync, spawn } from 'node:child_process';
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOME = '/srv/sensebod-offline';
const BACKEND = join(HOME, 'backend');
const DATA = '/data/sensebod-offline';
const CONF_DIR = '/data/config';
const STATE = '/run/sensebod-online';
const CONFIG = join(STATE, 'sensebod-offline.toml');
const PID_FILE = join(STATE, 'supervisor.pid');
const MAIN_DB = join(DATA, 'db', 'sensebod-offline.sqlite3');

const env = process.env;
const say = (message) => process.stdout.write(`[online] ${message}\n`);

function secret(name) {
  if (env[`${name}_FILE`]) return readFileSync(env[`${name}_FILE`], 'utf8').replace(/\r?\n$/, '');
  return env[name] ?? '';
}

/* ---------------- reset-demo: ask the running supervisor ---------------- */
if (process.argv[2] === 'reset-demo') {
  const pid = Number(readFileSync(PID_FILE, 'utf8'));
  process.kill(pid, 'SIGUSR2');
  say('Reset requested: all data on this server is being replaced by the demo lessons. Follow the container log.');
  process.exit(0);
}
if (process.argv[2] && process.argv[2] !== 'run') {
  process.stderr.write('Usage: supervise.mjs [run|reset-demo]\n');
  process.exit(2);
}

/* ---------------- guards ---------------- */
if (env.SENSEBOD_DEPLOY !== 'online') throw new Error('supervise.mjs is the online test server only: SENSEBOD_DEPLOY=online must be set.');
if (env.SENSEBOD_OFFLINE_DEV === '1') throw new Error('Do not set SENSEBOD_OFFLINE_DEV on the online server.');

const uid = Number(execFileSync('id', ['-u', 'node'], { encoding: 'utf8' }).trim());
const gid = Number(execFileSync('id', ['-g', 'node'], { encoding: 'utf8' }).trim());
const childEnv = { PATH: env.PATH, HOME: '/home/node', SENSEBOD_DEPLOY: 'online', TZ: env.TZ ?? 'UTC', NODE_ENV: 'production' };

function own(dir) {
  mkdirSync(dir, { recursive: true });
  chownSync(dir, uid, gid);
}

/* ---------------- 1. configuration ---------------- */
function toml(value) {
  return JSON.stringify(value);
}
function writeConfig() {
  const hosts = (env.SENSEBOD_PUBLIC_HOST ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const allowed = [...new Set([...hosts, 'localhost', '127.0.0.1'])];
  own(STATE);
  own(CONF_DIR);
  const recipients = join(CONF_DIR, 'backup-recipients.txt');
  if (env.SENSEBOD_BACKUP_RECIPIENTS) writeFileSync(recipients, `${env.SENSEBOD_BACKUP_RECIPIENTS.trim()}\n`);
  writeFileSync(
    CONFIG,
    [
      '# Written by deploy/online/supervise.mjs at every start. Online test server only.',
      '[bag]',
      `name = ${toml(env.SENSEBOD_BAG_NAME || 'Online test server')}`,
      '[server]',
      'host = "127.0.0.1"',
      'port = 8000',
      `allowed_hosts = ${toml(allowed)}`,
      'trust_proxy = true',
      '[paths]',
      `data_dir = ${toml(DATA)}`,
      'run_dir = "/run/sensebod-offline"',
      `recipients_file = ${toml(recipients)}`,
      `allowed_signers_file = ${toml(join(CONF_DIR, 'allowed_signers'))}`,
      '# Accepted only with SENSEBOD_DEPLOY=online (backend/src/config.ts):',
      '# a cloud machine keeps its clock by NTP, and there is no root helper (USB, power-off, clock, update).',
      '[dev]',
      'assume_clock = "synced"',
      'fake_privileged = true',
      '',
    ].join('\n'),
  );
  chownSync(CONFIG, uid, gid);
  if (hosts.length === 0) say('SENSEBOD_PUBLIC_HOST is not set: the API answers only for localhost / 127.0.0.1.');
}

/* ---------------- helpers that run the backend's own programs ---------------- */
function runTool(args, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...args, '--config', CONFIG], { cwd: BACKEND, env: childEnv, uid, gid, stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'] });
    if (input !== undefined) child.stdin.end(input);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function seedIfEmpty() {
  own('/data');
  own(DATA);
  own('/run/sensebod-offline');
  if (existsSync(MAIN_DB)) return;
  say('First start: creating the bag with the demo lessons.');
  const code = await runTool(['bin/sensebod-offline-admin.ts', 'init', '--demo', '--bag-name', env.SENSEBOD_BAG_NAME || 'Online test server']);
  if (code !== 0) throw new Error(`init failed (exit ${code})`);
}

async function bootRecover() {
  const code = await runTool(['bin/sensebod-offline-boot-recover.ts']);
  if (code !== 0) say('Boot recovery reported a problem: the API will answer 503 (maintenance) until it is fixed.');
}

async function ensureStaff() {
  const username = env.SENSEBOD_ADMIN_USERNAME;
  const password = secret('SENSEBOD_ADMIN_PASSWORD');
  if (!username || !password) {
    say('No SENSEBOD_ADMIN_USERNAME / SENSEBOD_ADMIN_PASSWORD: no staff account created.');
    return;
  }
  // The admin tool refuses a username that exists; that is the normal case after the first start.
  const exists = execFileSync(process.execPath, ['-e', `const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(MAIN_DB)},{readOnly:true});process.stdout.write(d.prepare('SELECT count(*) AS n FROM admin_account WHERE username = ?').get(${JSON.stringify(username)}).n>0?'yes':'no')`], { encoding: 'utf8', uid, gid, env: childEnv });
  if (exists === 'yes') return;
  const args = ['bin/sensebod-offline-admin.ts', 'create-hub-manager', '--username', username, '--display-name', env.SENSEBOD_ADMIN_DISPLAY_NAME || username, '--password-stdin'];
  const code = await runTool(args, password);
  if (code !== 0) say('The staff account could not be created (see the message above).');
}

/* ---------------- nginx ---------------- */
function writeNginx() {
  const port = String(Number(env.PORT) || 8080);
  let auth = '';
  const user = env.SENSEBOD_BASIC_AUTH_USER;
  const pass = secret('SENSEBOD_BASIC_AUTH_PASSWORD');
  if (user && pass) {
    const hash = execFileSync('openssl', ['passwd', '-6', '-stdin'], { input: pass, encoding: 'utf8' }).trim();
    writeFileSync(join(STATE, 'htpasswd'), `${user}:${hash}\n`, { mode: 0o640 });
    chownSync(join(STATE, 'htpasswd'), 0, Number(execFileSync('id', ['-g', 'www-data'], { encoding: 'utf8' }).trim()));
    auth = `    auth_basic "Sensebod Offline test server";\n    auth_basic_user_file ${join(STATE, 'htpasswd')};`;
    say('Site password is on (SENSEBOD_BASIC_AUTH_USER).');
  }
  const secure = env.SENSEBOD_COOKIE_SECURE !== '0' ? '      proxy_cookie_flags ~ secure;' : '';
  const text = readFileSync(join(HOME, 'deploy', 'nginx.conf.template'), 'utf8').replace(/__PORT__/g, port).replace('__AUTH__', auth).replace('__COOKIE_FLAGS__', secure);
  writeFileSync(join(STATE, 'nginx.conf'), text);
  execFileSync('nginx', ['-t', '-q', '-c', join(STATE, 'nginx.conf')], { stdio: 'inherit' });
}

/* ---------------- 5. the long-running processes ---------------- */
const services = {
  nginx: { cmd: 'nginx', args: ['-g', 'daemon off;', '-c', join(STATE, 'nginx.conf')], asRoot: true },
  api: { cmd: process.execPath, args: ['bin/sensebod-offline-api.ts', '--config', CONFIG] },
  worker: { cmd: process.execPath, args: ['bin/sensebod-offline-worker.ts', '--config', CONFIG] },
};
const running = new Map();
let stopping = false;
let paused = false;

function start(name) {
  const s = services[name];
  const child = spawn(s.cmd, s.args, { cwd: BACKEND, env: s.asRoot ? env : childEnv, stdio: ['ignore', 'inherit', 'inherit'], ...(s.asRoot ? {} : { uid, gid }) });
  running.set(name, child);
  child.on('exit', (code, signal) => {
    running.delete(name);
    if (stopping || (paused && name !== 'nginx')) return;
    say(`${name} stopped (${signal ?? code}); starting it again in 2 s.`);
    setTimeout(() => {
      if (!stopping && !(paused && name !== 'nginx')) start(name);
    }, 2000).unref();
  });
}

function stop(names) {
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          const child = running.get(name);
          if (!child) return resolve();
          const kill = setTimeout(() => child.kill('SIGKILL'), 25_000);
          child.on('exit', () => {
            clearTimeout(kill);
            resolve();
          });
          child.kill(name === 'nginx' ? 'SIGQUIT' : 'SIGTERM');
        }),
    ),
  );
}

let maintBusy = false;
async function maintenance() {
  if (maintBusy || paused || stopping) return;
  maintBusy = true;
  await runTool(['bin/sensebod-offline-maint.ts']);
  maintBusy = false;
}

async function resetDemo() {
  if (paused) return;
  paused = true;
  say('Reset to demo data: stopping the API and the worker.');
  await stop(['api', 'worker']);
  for (const name of readdirSync(DATA)) rmSync(join(DATA, name), { recursive: true, force: true });
  rmSync('/run/sensebod-offline', { recursive: true, force: true });
  await seedIfEmpty();
  await bootRecover();
  await ensureStaff();
  paused = false;
  start('api');
  start('worker');
  say('Reset done: demo lessons restored, every upload, learner and export removed.');
}

async function main() {
  writeConfig();
  await seedIfEmpty();
  await bootRecover();
  await ensureStaff();
  writeNginx();
  writeFileSync(PID_FILE, String(process.pid));
  for (const name of ['nginx', 'api', 'worker']) start(name);
  setTimeout(() => void maintenance(), 60_000).unref();
  setInterval(() => void maintenance(), 15 * 60_000);
  process.on('SIGUSR2', () => void resetDemo().catch((error) => say(`Reset failed: ${error.message}`)));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      say(`${signal}: stopping.`);
      // The API writes its clean-shutdown marker on SIGTERM; nginx stops last.
      void stop(['api', 'worker'])
        .then(() => stop(['nginx']))
        .then(() => process.exit(0));
    });
  }
  say(`Ready on port ${Number(env.PORT) || 8080}.`);
}

main().catch((error) => {
  process.stderr.write(`[online] start failed: ${error.stack ?? error}\n`);
  process.exit(1);
});
