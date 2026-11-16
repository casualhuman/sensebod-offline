/*
 * Test harness: a real bag in a temporary folder (real SQLite files, real
 * migrations, real boot recovery), the real Express app on a loopback port,
 * and small helpers to talk to it. Nothing is mocked.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { importSeed, defaultSeedPath } from '../src/catalog/seed.ts';
import { type Config, loadConfig } from '../src/config.ts';
import { Ctx, loadKeys } from '../src/core/context.ts';
import { Db } from '../src/core/db.ts';
import { setLogSink } from '../src/core/log.ts';
import { hashPassword } from '../src/identity/passwords.ts';
import { insertAccount } from '../src/identity/routes.ts';
import { bootRecover, initBag } from '../src/system/bootstrap.ts';
import { paths as buildPaths } from '../src/config.ts';
import { VERSION } from '../src/version.ts';

process.env.SENSEBOD_OFFLINE_DEV = '1';

export const HUB = { username: 'hub', password: 'correct horse battery' };
export const ADMIN = { username: 'facil', password: 'another long password' };
export const OVERRIDE_KEY = 'ab'.repeat(32);

export interface Bag {
  dir: string;
  configPath: string;
  config: Config;
  ctx: Ctx;
  server: Server;
  base: string;
  logs: string[];
  close(): Promise<void>;
}

export interface BagOptions {
  demo?: boolean;
  toml?: string;
  role?: 'api' | 'batch';
  listen?: boolean;
}

export function writeConfig(dir: string, extra = ''): string {
  const file = join(dir, 'sensebod-offline.toml');
  writeFileSync(
    file,
    `[bag]
name = "Test bag"
[server]
allowed_hosts = ["127.0.0.1", "localhost"]
trust_proxy = true
[paths]
data_dir = "${join(dir, 'data')}"
run_dir = "${join(dir, 'run')}"
recipients_file = "${join(dir, 'recipients.txt')}"
allowed_signers_file = "${join(dir, 'allowed_signers')}"
[limits]
reserve_bytes = 0
low_bytes = 0
chunk_bytes = 65536
[dev]
self_recover = true
serve_files = true
assume_clock = "synced"
fake_privileged = true
${extra}`,
  );
  return file;
}

export async function makeBag(options: BagOptions = {}): Promise<Bag> {
  const dir = mkdtempSync(join(os.tmpdir(), 'sensebod-offline-test-'));
  const configPath = writeConfig(dir, options.toml ?? '');
  const config = loadConfig(configPath);
  initBag(config, { bagName: 'Test bag', override: { version: 1, keyHex: OVERRIDE_KEY } });
  const p = buildPaths(config);
  const seedDb = new Db(p.mainDb, { role: 'batch' });
  importSeed(seedDb, defaultSeedPath(), { demo: options.demo !== false });
  seedDb.close();
  const boot = bootRecover(config).boot;
  const ctx = new Ctx({ config, role: options.role ?? 'api', version: VERSION, boot, keys: loadKeys(p) });
  const [hubHash, adminHash] = await Promise.all([hashPassword(HUB.password, { ln: 10, r: 8, p: 1 }), hashPassword(ADMIN.password, { ln: 10, r: 8, p: 1 })]);
  ctx.writeSync((tx) => {
    insertAccount(tx, { username: HUB.username, displayName: 'Hub Manager', role: 'hub_manager', passwordHash: hubHash, mustChangePassword: false });
    insertAccount(tx, { username: ADMIN.username, displayName: 'Facilitator', role: 'admin', passwordHash: adminHash, mustChangePassword: false });
  });
  const logs: string[] = [];
  setLogSink((line) => logs.push(line));
  const server = createServer(buildApp(ctx));
  if (options.listen !== false) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = options.listen !== false ? (server.address() as AddressInfo).port : 0;
  return {
    dir,
    configPath,
    config,
    ctx,
    server,
    base: `http://127.0.0.1:${port}/api/v1`,
    logs,
    async close() {
      setLogSink(null);
      if (options.listen !== false) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Reply {
  status: number;
  headers: Headers;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

/** A browser-like client with a cookie jar, the CSRF header on unsafe methods, and a chosen "phone address". */
export class Client {
  readonly base: string;
  cookies = new Map<string, string>();
  ip: string;
  private keySeq = 0;

  constructor(bag: { base: string }, ip = '10.10.0.51') {
    this.base = bag.base;
    this.ip = ip;
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const send: Record<string, string> = { 'X-Forwarded-For': this.ip, ...headers };
    if (method !== 'GET' && send['X-Sensebod-Offline-Client'] === undefined) send['X-Sensebod-Offline-Client'] = '1';
    if (send['X-Sensebod-Offline-Client'] === '') delete send['X-Sensebod-Offline-Client'];
    if (this.cookies.size > 0) send.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: string | Uint8Array | undefined;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      send['Content-Type'] = 'application/json';
    }
    const response = await fetch(this.base + path, { method, headers: send, ...(payload === undefined ? {} : { body: payload as RequestInit['body'] }), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /Max-Age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, headers: response.headers, body: parsed, text };
  }

  get(path: string, headers?: Record<string, string>): Promise<Reply> {
    return this.request('GET', path, undefined, headers);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply> {
    return this.request('POST', path, body, headers);
  }
  put(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply> {
    return this.request('PUT', path, body, headers);
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply> {
    return this.request('PATCH', path, body, headers);
  }
  delete(path: string, headers?: Record<string, string>): Promise<Reply> {
    return this.request('DELETE', path, undefined, headers);
  }
  /** A fresh Idempotency-Key header. */
  key(): Record<string, string> {
    this.keySeq += 1;
    return { 'Idempotency-Key': `test-key-${Date.now()}-${this.keySeq}-${Math.random().toString(36).slice(2)}` };
  }
  async signIn(who: { username: string; password: string }): Promise<Reply> {
    return this.post('/admin/session', who);
  }
  async confirm(who: { password: string }): Promise<Reply> {
    return this.post('/admin/session/confirm', { password: who.password });
  }
}

export async function signedIn(bag: Bag, who = HUB, ip = '10.10.0.51'): Promise<Client> {
  const client = new Client(bag, ip);
  const reply = await client.signIn(who);
  if (reply.status !== 200) throw new Error(`sign-in failed: ${reply.status} ${reply.text}`);
  return client;
}

/** A plain HTTP GET with full control of the headers (fetch refuses to set Host). */
export function rawGet(url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: 'GET', headers }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 15_000, everyMs = 50): Promise<NonNullable<T>> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await sleep(everyMs);
  }
}
