/*
 * sensebod-offline-admin: the technician's command line on the bag (physical access or SSH).
 *
 *   init [--bag-name <name>] [--bag-id <uuid>] [--demo]   create the data directory, databases and keys
 *   seed [--demo]                                        load the portals and groups (and sample lessons)
 *   migrate                                              apply pending migrations (update procedure only)
 *   create-hub-manager --username <u> --display-name <n> first or extra hub manager
 *   reset-password --username <u>                        emergency only (SYSTEM-ARCHITECTURE §9.4)
 *   restore --from <.sbk> --identity <age key> (--registry <json> | --min-epoch <n> | --no-office-record) [--media-dir <dir>]
 *   new-epoch (--registry <json> | --min-epoch <n>)      after an epoch clash reported by the office (SYNC §3.2)
 *   status                                               the same JSON as GET /admin/status
 *   selfcheck                                            what bin/sensebod-offline-selfcheck prints (R-11)
 *
 * Passwords are read from the terminal without echo, or from standard input
 * with --password-stdin. They are never taken from the command line, where
 * every user of the machine could read them.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { configPathFromArgv, loadConfig, paths as buildPaths } from '../src/config.ts';
import { importSeed, defaultSeedPath } from '../src/catalog/seed.ts';
import { Db } from '../src/core/db.ts';
import { migrate } from '../src/core/migrate.ts';
import { nowIso } from '../src/core/time.ts';
import { insertAccount } from '../src/identity/routes.ts';
import { hashPassword, passwordProblem } from '../src/identity/passwords.ts';
import { endSessionsOf } from '../src/identity/sessions.ts';
import { initBag } from '../src/system/bootstrap.ts';
import { statusBody } from '../src/system/routes.ts';
import { RestoreRefused, manifestOf, minEpochFromRegistry, newEpoch, restoreBackup } from '../src/system/restore.ts';
import { selfCheck } from '../src/system/selfcheck.ts';
import { openContext } from '../src/system/start.ts';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const flag = (name: string): boolean => argv.indexOf(`--${name}`) !== -1;
const option = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

async function readPassword(prompt: string): Promise<string> {
  if (flag('password-stdin') || !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (text: string) => void };
  let muted = false;
  out._writeToOutput = (text: string) => {
    if (!muted) process.stdout.write(text);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => (rl.close(), resolve(answer))));
}

/** One line from the terminal, synchronously (the restore confirmation is asked from inside a synchronous step). */
function readlineSync(prompt: string): string {
  process.stdout.write(prompt);
  const buffer = Buffer.alloc(256);
  const n = readSync(0, buffer, 0, 256, null);
  return buffer.toString('utf8', 0, n).trim();
}

function bagIdOf(mainDb: string): string {
  const db = new Db(mainDb, { role: 'batch', readOnly: true });
  try {
    return String(db.value("SELECT value FROM bag_meta WHERE key = 'bag_id'") ?? '');
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const config = loadConfig(configPathFromArgv());
  const p = buildPaths(config);

  if (command === 'init') {
    const bagName = option('bag-name');
    const bagId = option('bag-id');
    const result = initBag(config, { ...(bagName ? { bagName } : {}), ...(bagId ? { bagId } : {}) });
    const db = new Db(p.mainDb, { role: 'batch' });
    try {
      const counts = importSeed(db, defaultSeedPath(), { demo: flag('demo') });
      process.stdout.write(`${result.created ? 'Created' : 'Checked'} bag ${result.bagId} in ${p.data}\n${JSON.stringify(counts)}\n`);
    } finally {
      db.close();
    }
    return;
  }

  if (command === 'seed') {
    const db = new Db(p.mainDb, { role: 'batch' });
    try {
      process.stdout.write(`${JSON.stringify(importSeed(db, option('file') ?? defaultSeedPath(), { demo: flag('demo') }))}\n`);
    } finally {
      db.close();
    }
    return;
  }

  if (command === 'migrate') {
    for (const which of ['main', 'counts'] as const) {
      const db = new Db(which === 'main' ? p.mainDb : p.countsDb, { role: 'batch' });
      try {
        process.stdout.write(`${which}: ${JSON.stringify(migrate(db, which))}\n`);
      } finally {
        db.close();
      }
    }
    return;
  }

  if (command === 'selfcheck') {
    const report = selfCheck(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exit(1);
    return;
  }

  if (command === 'create-hub-manager' || command === 'reset-password') {
    const username = option('username') ?? fail('--username is needed.');
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) fail('The username must be 3 to 32 letters, numbers, dots or dashes.');
    const password = await readPassword('Password (at least 10 characters): ');
    const problem = passwordProblem(password, username);
    if (problem) fail(problem);
    const hash = await hashPassword(password);
    const ctx = openContext('batch');
    try {
      ctx.writeSync((tx) => {
        const existing = tx.get<{ id: string }>('SELECT id FROM admin_account WHERE username = ?', username);
        if (command === 'create-hub-manager') {
          if (existing) fail('That username is already used on this bag.');
          // Set by EasySTEM at deployment: no forced change at first sign-in (OWNER-3).
          const id = insertAccount(tx, { username, displayName: option('display-name') ?? username, role: 'hub_manager', passwordHash: hash, mustChangePassword: false });
          tx.audit({ actorId: 'technician-cli', actorName: 'technician-cli', action: 'admin.account.create', targetType: 'admin_account', targetId: id, detail: { role: 'hub_manager' } });
        } else {
          if (!existing) fail('No account has that username.');
          tx.run('UPDATE admin_account SET password_hash = ?, must_change_password = 1, failed_count = 0, locked_until = NULL, password_changed_at = ?, seq = ? WHERE id = ?', hash, nowIso(), tx.seq(), existing.id);
          endSessionsOf(tx, existing.id, null);
          tx.audit({ actorId: 'technician-cli', actorName: 'technician-cli', action: 'admin.account.reset', targetType: 'admin_account', targetId: existing.id });
        }
      });
      process.stdout.write(command === 'create-hub-manager' ? `Hub manager ${username} created.\n` : `Password of ${username} reset. They must choose a new one at sign-in.\n`);
    } finally {
      ctx.close();
    }
    return;
  }

  if (command === 'new-epoch') {
    const min = option('min-epoch') !== undefined ? Number(option('min-epoch')) : option('registry') ? minEpochFromRegistry(config, option('registry') as string, bagIdOf(p.mainDb)) : fail('--registry <bag-registry.json> or --min-epoch <n> is needed.');
    if (!Number.isSafeInteger(min) || min < 0) fail('--min-epoch must be a whole number.');
    // Never on a live bag: the API and the worker are stopped (maintenance mode) for the re-stamp.
    const services = (verb: string): void => {
      if (!config.dev.fakePrivileged) execFileSync(config.tools.systemctl, [verb, 'sensebod-offline-worker.service', 'sensebod-offline-api.service'], { stdio: 'inherit' });
    };
    writeFileSync(p.maintenanceFlag, 'new-epoch\n');
    services('stop');
    try {
      process.stdout.write(`${JSON.stringify(newEpoch(config, min))}\n`);
    } finally {
      rmSync(p.maintenanceFlag, { force: true });
      services('start');
    }
    return;
  }

  if (command === 'restore') {
    const from = option('from') ?? fail('--from <backup .sbk> is needed.');
    const identity = option('identity');
    const work = join(p.restore, `incoming-${process.pid}.tar`);
    mkdirSync(p.restore, { recursive: true, mode: 0o700 });
    try {
      // `age` asks for the passphrase of the identity file on the terminal itself; nothing secret is on the command line.
      if (identity) execFileSync(config.tools.age, ['-d', '-i', identity, '-o', work, from], { stdio: 'inherit' });
      else if (flag('already-decrypted')) copyFileSync(from, work);
      else fail('--identity <age key file> is needed (the EasySTEM backup key on the key stick).');
      const manifest = manifestOf(work);
      let minEpoch: number | null;
      if (option('min-epoch') !== undefined) minEpoch = Number(option('min-epoch'));
      else if (option('registry')) minEpoch = minEpochFromRegistry(config, option('registry') as string, manifest.bagId);
      else if (flag('no-office-record')) {
        const typed = await ask('Type exactly: No backup of this bag ever reached the office.\n> ');
        if (typed !== 'No backup of this bag ever reached the office.') fail('Not confirmed. Nothing was changed.');
        minEpoch = null;
      } else fail('The office record is needed: --registry <bag-registry.json>, or --min-epoch <n>, or --no-office-record.');
      if (minEpoch !== null && (!Number.isSafeInteger(minEpoch) || minEpoch < 0)) fail('--min-epoch must be a whole number.');
      const systemctl = (verb: string): void => {
        if (!config.dev.fakePrivileged) execFileSync(config.tools.systemctl, [verb, 'sensebod-offline-worker.service', 'sensebod-offline-api.service'], { stdio: 'inherit' });
      };
      let answer = flag('yes') ? 'RESTORE' : '';
      const report = restoreBackup(config, {
        tarFile: work,
        minEpoch,
        ...(option('media-dir') ? { mediaDir: option('media-dir') as string } : {}),
        services: { stop: () => systemctl('stop'), start: () => systemctl('start') },
        confirm(summary) {
          process.stdout.write(
            `\nBag: ${summary.bagName} (${summary.bagId})\nBackup made: ${summary.backupCreatedAt}\nIn the backup: ${summary.learnersInBackup} learners, ${summary.lessonsInBackup} lessons\n` +
              (summary.learnersOnlyOnBag > 0 ? `This bag has ${summary.learnersOnlyOnBag} learners that are not in the backup. They will be lost.\n` : '') +
              (summary.missingMedia > 0 ? `${summary.missingMedia} lesson files are not on this bag; lessons that need them will be unpublished unless --media-dir has them.\n` : '') +
              `New epoch: ${summary.newEpoch}\nThe old card of this bag must not be used in the field again.\n`,
          );
          if (answer === '') answer = readlineSync('Type RESTORE to continue: ');
          return answer === 'RESTORE';
        },
      });
      process.stdout.write(`Restored.\n${JSON.stringify(report, null, 2)}\nThe override secret is not in a backup: provision it again from the bundle of this bag.\n`);
    } catch (error) {
      if (error instanceof RestoreRefused) fail(error.message);
      throw error;
    } finally {
      rmSync(work, { force: true });
    }
    return;
  }

  if (command === 'status') {
    const ctx = openContext('batch');
    try {
      process.stdout.write(`${JSON.stringify(statusBody(ctx), null, 2)}\n`);
    } finally {
      ctx.close();
    }
    return;
  }

  process.stdout.write('Commands: init, seed, migrate, create-hub-manager, reset-password, restore, new-epoch, status, selfcheck\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
