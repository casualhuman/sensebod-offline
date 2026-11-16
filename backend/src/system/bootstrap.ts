/*
 * Provisioning of the data directory and the boot recovery routine
 * (sensebod-offline-boot-recover.service; DATA-EXPORT §13, DATABASE §9.3–9.4).
 *
 * Boot recovery runs once per boot, before the worker and the API. It is
 * re-runnable: every step looks at what is on disk and in the database, and
 * the record of having run (run/boot.json) is written last.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { type Config, type Paths, paths as buildPaths } from '../config.ts';
import { type BootInfo, type ClockState, type ClockTrust, currentBootId, readClockState } from '../core/context.ts';
import { Db, SqliteCorruptError, checkDatabase, assertSqliteVersion } from '../core/db.ts';
import { ensureDir, fsyncDir, removeQuietly, writeFileDurable } from '../core/fsx.ts';
import { newId } from '../core/ids.ts';
import { log } from '../core/log.ts';
import { headState, migrate } from '../core/migrate.ts';
import { finishIncoming, incomingPath, replaceLiveDatabase, removeDatabaseFiles, stagedPath } from '../core/replace.ts';
import { DAY, HOUR, dayOf, nowIso } from '../core/time.ts';
import { listSnapshots, snapshotIsSound } from '../exports/snapshots.ts';

const DIR_MODES: [keyof Paths, number][] = [
  ['data', 0o751],
  ['dbDir', 0o700],
  ['media', 0o755],
  ['mediaOrphans', 0o700],
  ['tryit', 0o755],
  ['uploadsPartial', 0o700],
  ['exports', 0o750],
  ['exportsTmp', 0o700],
  ['snapshots', 0o700],
  ['jobsTmp', 0o700],
  ['keys', 0o700],
  ['state', 0o700],
  ['update', 0o700],
  ['restore', 0o700],
  ['tmp', 0o700],
];

export function ensureDataDirs(p: Paths): void {
  for (const [key, mode] of DIR_MODES) ensureDir(p[key], mode);
  ensureDir(join(p.media, 'c'), 0o755);
  ensureDir(join(p.media, 'd'), 0o755);
  ensureDir(join(p.snapshots, '.tmp'), 0o700);
  // /run/sensebod-offline/* are made by tmpfiles.d on a bag; on a laptop they are made here.
  for (const dir of [p.run, p.exportSecrets, p.requests]) {
    try {
      ensureDir(dir, dir === p.run ? 0o755 : 0o700);
    } catch {
      // not ours to create (tmpfiles.d owns it)
    }
  }
}

function createDatabase(file: string, which: 'main' | 'counts'): Db {
  const db = new Db(file, { role: 'batch', skipWalAssert: true });
  db.exec('PRAGMA journal_mode=WAL');
  assertSqliteVersion(db);
  migrate(db, which);
  return db;
}

function writeKey(file: string, bytes = 32): void {
  if (existsSync(file)) return;
  writeFileDurable(file, randomBytes(bytes), 0o600);
  chmodSync(file, 0o600);
}

export interface InitOptions {
  bagId?: string;
  bagName?: string;
  /** Per-bag override secret from the provisioning bundle (ADR-017). */
  override?: { version: number; keyHex: string };
}

/** Create the data directory, both databases at the release's schema head, the bag's identity and its keys. Safe to run again. */
export function initBag(config: Config, options: InitOptions = {}): { bagId: string; created: boolean } {
  const p = buildPaths(config);
  ensureDataDirs(p);
  const created = !existsSync(p.mainDb);
  const main = createDatabase(p.mainDb, 'main');
  let bagId = '';
  try {
    main.tx(() => {
      const put = (key: string, value: string): void => {
        main.run('INSERT INTO bag_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', key, value);
      };
      put('bag_id', options.bagId ?? randomUUID());
      put('bag_name', options.bagName ?? config.bag.name);
      put('provisioned_at', nowIso());
      put('change_seq', '0');
      put('epoch', '1');
      put('epoch_nonce', randomBytes(16).toString('hex'));
      put('epoch_base_seq', '0');
      put('uptime_total_s', '0');
      put('boot_seq', '0');
      put('content_rev', '1');
    });
    bagId = String(main.value("SELECT value FROM bag_meta WHERE key = 'bag_id'"));
  } finally {
    main.close();
  }
  const counts = createDatabase(p.countsDb, 'counts');
  try {
    counts.tx(() => {
      counts.run("INSERT INTO counts_meta (key, value) VALUES ('bag_id', ?) ON CONFLICT (key) DO NOTHING", bagId);
      counts.run("INSERT INTO counts_meta (key, value) VALUES ('schema_version', '1') ON CONFLICT (key) DO NOTHING");
    });
  } finally {
    counts.close();
  }
  writeKey(join(p.keys, 'ticket.key'));
  writeKey(join(p.keys, 'session.pepper'));
  if (options.override) {
    if (!/^[0-9a-f]{64}$/.test(options.override.keyHex)) throw new Error('The override secret must be 64 hex characters.');
    writeFileDurable(join(p.keys, 'override.key'), JSON.stringify({ version: options.override.version, key: options.override.keyHex }), 0o600);
  }
  return { bagId, created };
}

/* ------------------------------------------------------------------ */
/* clock                                                               */
/* ------------------------------------------------------------------ */

/** A date before the release was built cannot be right. */
const RELEASE_FLOOR_MS = Date.parse('2026-11-01T00:00:00Z');

function ntpSynchronised(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return execFileSync('timedatectl', ['show', '-p', 'NTPSynchronized', '--value'], { encoding: 'utf8', timeout: 3000 }).trim() === 'yes';
  } catch {
    return false;
  }
}

function rtcLooksValid(): boolean {
  try {
    const seconds = Number(readFileSync('/sys/class/rtc/rtc0/since_epoch', 'utf8').trim());
    // Without a battery the Pi's RTC restarts near 1970 after a power cut.
    return Number.isFinite(seconds) && seconds * 1000 > RELEASE_FLOOR_MS && Math.abs(seconds * 1000 - Date.now()) < 5 * 60_000;
  } catch {
    return false;
  }
}

/**
 * How far the clock can be believed at this boot (ADR-014). A date that a hub
 * manager set by hand stays `manual` across boots, even when the RTC now
 * reads it back, until NTP confirms it (V-039).
 */
export function detectClockTrust(previous: ClockState, assume: Config['dev']['assumeClock']): ClockTrust {
  if (assume) return assume;
  if (ntpSynchronised()) return 'synced';
  if (previous.handSetUnconfirmed || previous.pending) return 'manual';
  if (rtcLooksValid()) return 'rtc';
  return Date.now() > RELEASE_FLOOR_MS ? 'restored' : 'unsure';
}

/* ------------------------------------------------------------------ */
/* boot recovery                                                       */
/* ------------------------------------------------------------------ */

export interface RecoverResult {
  boot: BootInfo;
  notes: string[];
  maintenance: boolean;
  alreadyDone: boolean;
}

function emptyDir(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) removeQuietly(join(dir, name));
  fsyncDir(dir);
}

/**
 * Open a database for the checks of DATABASE §3. Returns null ONLY when the
 * file is damaged: SQLite says it is corrupt or not a database, or
 * quick_check / foreign_key_check fail. Every other failure (permissions, a
 * full or read-only filesystem, a lock held by a stray process, a missing
 * file) is thrown: rolling the bag back to a snapshot would then destroy good
 * data for a problem a snapshot cannot fix.
 */
function openChecked(file: string): Db | null {
  if (!existsSync(file)) throw new Error(`The database file ${file} is missing.`);
  // Readable and writable by this user? If not, this is not corruption.
  accessSync(file, constants.R_OK | constants.W_OK);
  let db: Db | null = null;
  try {
    // journal_mode is persistent and set at provisioning, but a replacement cut between "renamed in" and
    // "switched to WAL" leaves a sound file in rollback mode. Boot recovery is the one place that puts it right.
    db = new Db(file, { role: 'batch', skipWalAssert: true });
    if (db.value('PRAGMA journal_mode') !== 'wal') db.exec('PRAGMA journal_mode=WAL');
    if (db.value('PRAGMA journal_mode') !== 'wal') throw new Error(`The database ${file} could not be switched to WAL mode.`);
    if (!checkDatabase(db) || db.all('PRAGMA foreign_key_check').length > 0) {
      db.close();
      return null;
    }
    return db;
  } catch (error) {
    db?.close();
    if (error instanceof SqliteCorruptError) return null;
    throw error;
  }
}

function lastSeenWall(p: Paths): number | null {
  try {
    const raw = JSON.parse(readFileSync(p.clockJson, 'utf8')) as { lastSeenWall?: unknown };
    return typeof raw.lastSeenWall === 'string' ? Date.parse(raw.lastSeenWall) : null;
  } catch {
    return null;
  }
}

export function writeClockState(p: Paths, state: ClockState & { lastSeenWall?: string }): void {
  writeFileDurable(p.clockJson, JSON.stringify({ ...state, lastSeenWall: state.lastSeenWall ?? nowIso() }), 0o600);
}

export function bootRecover(config: Config): RecoverResult {
  const p = buildPaths(config);
  ensureDataDirs(p);
  const bootId = currentBootId();
  const notes: string[] = [];

  // Already done in this boot (the unit was started twice, or a laptop restart of the API).
  try {
    const done = JSON.parse(readFileSync(p.bootJson, 'utf8')) as BootInfo;
    if (done.bootId === bootId) return { boot: done, notes: [], maintenance: existsSync(p.maintenanceFlag), alreadyDone: true };
  } catch {
    // first run of this boot
  }

  // Step 1: was the last shutdown clean?
  const previousClean = existsSync(p.cleanShutdownMarker);
  rmSync(p.cleanShutdownMarker, { force: true });

  // Step 3: both database files. A corrupt main file goes back to the newest sound local snapshot
  // with a new epoch; a corrupt counts file is replaced or recreated and never blocks the API.
  // A replacement that was cut between "old file moved away" and "new file renamed in" left a complete,
  // already lifted `.incoming` and no live file: finish it. A leftover next to a live file is just removed.
  // `.incoming` was never finished (not lifted, perhaps half copied): it is always discarded.
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(incomingPath(p.mainDb) + suffix, { force: true });
  const staged = stagedPath(p.mainDb);
  if (existsSync(staged)) {
    if (existsSync(p.mainDb)) rmSync(staged, { force: true });
    else {
      finishIncoming(p.mainDb);
      notes.push('A replacement of the database was finished after a power cut.');
    }
  }
  // A restore that was cut after the swap is not complete (media, secrets, audit): the bag stays closed
  // until the technician runs the restore again. Before the swap nothing was changed: the journal is dropped.
  const restoreJournal = join(p.restore, 'state.json');
  if (existsSync(restoreJournal)) {
    let step = '';
    try {
      step = String((JSON.parse(readFileSync(restoreJournal, 'utf8')) as { step?: string }).step ?? '');
    } catch {
      step = '';
    }
    if (step === 'swapping' || step === 'swapped') {
      try {
        writeFileSync(p.maintenanceFlag, 'restore not finished\n');
      } catch {
        // /run may not be writable for this user
      }
      log('boot.recover', { result: 'maintenance', reason: 'restore_not_finished' });
      return { boot: { bootId, bootSeq: 0, uptimeBaseS: 0, previousClean, startedAt: nowIso() }, notes: ['A restore was interrupted. Run the restore again.'], maintenance: true, alreadyDone: false };
    }
    rmSync(restoreJournal, { force: true });
  }
  let main = openChecked(p.mainDb);
  if (!main) {
    const aside = join(p.dbDir, `corrupt-${bootId}-${Date.now()}`);
    const candidate = listSnapshots(p).find((s) => snapshotIsSound(s.path));
    if (!candidate) {
      // Nothing to go back to: maintenance mode, a technician restores from an off-bag backup.
      try {
        writeFileSync(p.maintenanceFlag, 'database unusable, no sound local snapshot\n');
      } catch {
        // /run may not be writable for this user
      }
      log('boot.recover', { result: 'maintenance', reason: 'no_sound_snapshot' });
      const boot: BootInfo = { bootId, bootSeq: 0, uptimeBaseS: 0, previousClean, startedAt: nowIso() };
      return { boot, notes: ['The database could not be opened and no saved copy was usable.'], maintenance: true, alreadyDone: false };
    }
    const minEpoch = Math.max(0, ...listSnapshots(p).map((s) => s.epoch));
    const when = new Date(candidate.mtimeMs).toISOString();
    const epoch = replaceLiveDatabase({ dbPath: p.mainDb, source: candidate.path, asideDir: aside, minEpoch, restoredFrom: when });
    notes.push(`The bag went back to its saved copy from ${when.slice(0, 16).replace('T', ' ')}. Changes after that were lost.`);
    log('boot.recover', { result: 'snapshot_restored', epoch });
    main = openChecked(p.mainDb);
    if (!main) throw new Error('The restored snapshot could not be opened.');
  }
  // The counts file never blocks the API: a missing one is recreated, a damaged one replaced (DATABASE §9.4).
  let counts = existsSync(p.countsDb) ? openChecked(p.countsDb) : null;
  if (!counts) {
    removeDatabaseFiles(p.countsDb, existsSync(p.countsDb) ? join(p.dbDir, `corrupt-${bootId}`) : null);
    const candidate = listSnapshots(p).find((s) => s.countsPath !== null && snapshotIsSound(s.countsPath));
    if (candidate && candidate.countsPath) {
      const tmp = p.countsDb + '.incoming';
      rmSync(tmp, { force: true });
      const source = new Db(candidate.countsPath, { role: 'batch', readOnly: true, skipWalAssert: true });
      try {
        source.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      } finally {
        source.close();
      }
      renameSync(tmp, p.countsDb);
      fsyncDir(p.dbDir);
      notes.push(`Child protection counts went back to ${new Date(candidate.mtimeMs).toISOString().slice(0, 10)}.`);
    } else {
      notes.push('Child protection counts were reset.');
    }
    const fresh = new Db(p.countsDb, { role: 'batch', skipWalAssert: true });
    fresh.exec('PRAGMA journal_mode=WAL');
    migrate(fresh, 'counts');
    fresh.close();
    counts = openChecked(p.countsDb);
  }
  counts?.close();

  try {
    // The schema must be the release's. Migrations run only from the update procedure (R-5).
    const head = headState(main, 'main');
    if (head !== 'equal') {
      try {
        writeFileSync(p.maintenanceFlag, `schema ${head}\n`);
      } catch {
        // see above
      }
      notes.push('The database does not match this version of Sensebod Offline.');
      const boot: BootInfo = { bootId, bootSeq: 0, uptimeBaseS: 0, previousClean, startedAt: nowIso() };
      return { boot, notes, maintenance: true, alreadyDone: false };
    }

    // Clock (ADR-014, V-033, V-039).
    const previousClock = readClockState(p);
    const seenBefore = lastSeenWall(p);
    const trust = detectClockTrust(previousClock, config.dev.assumeClock);
    const now = nowIso();
    const jumpDays = seenBefore === null ? 0 : Math.floor((Date.now() - seenBefore) / DAY);

    const db = main;
    const startedAt = now;
    const info = db.tx((): BootInfo => {
      const meta = (key: string): number => Number(db.value('SELECT value FROM bag_meta WHERE key = ?', key) ?? 0);
      // boot_seq is monotonic and committed before the API starts (V-034).
      const bootSeq = meta('boot_seq') + 1;
      db.run("UPDATE bag_meta SET value = ? WHERE key = 'boot_seq'", String(bootSeq));
      const uptimeBaseS = meta('uptime_total_s');
      const audit = (action: string, outcome: string, detail: Record<string, unknown>, targetType: string | null = null, targetId: string | null = null): void => {
        db.run(
          "INSERT INTO audit_event (at, boot_id, clock_trust, actor_id, actor_name, action, target_type, target_id, outcome, detail_json) VALUES (?, ?, ?, 'system', 'system', ?, ?, ?, ?, ?)",
          now,
          bootId,
          trust,
          action,
          targetType,
          targetId,
          outcome,
          JSON.stringify(detail),
        );
      };

      // Step 1: sessions and lockouts used a wall clock that may have jumped (V-012). Failure counts are kept.
      db.run('DELETE FROM admin_session');
      db.run('UPDATE admin_account SET locked_until = NULL WHERE locked_until IS NOT NULL');
      db.run('DELETE FROM override_presence');

      // A hand-set date that was recorded but whose bookkeeping never finished (power cut while the clock was set).
      if (previousClock.pending) {
        audit('clock.set', 'interrupted', { from: previousClock.pending.from, to: previousClock.pending.to, source: 'manual', note: 'found at boot' });
      }
      // An unexplained forward step of more than 7 days never counts toward removing learner data until confirmed (V-033).
      if (jumpDays > 7 && trust !== 'rtc' && trust !== 'synced' && seenBefore !== null) {
        db.run(
          "INSERT INTO clock_jump (id, at_uptime_s, from_time, to_time, days, source) VALUES (?, ?, ?, ?, ?, ?)",
          newId('cj'),
          uptimeBaseS,
          new Date(seenBefore).toISOString(),
          now,
          jumpDays,
          trust === 'manual' ? 'manual' : 'unexplained',
        );
        audit('clock.boot', 'ok', { from: new Date(seenBefore).toISOString(), to: now, days: jumpDays, source: 'boot', guarded: true });
      } else if (seenBefore !== null && Math.abs(Date.now() - seenBefore) > HOUR && jumpDays > 0) {
        audit('clock.boot', 'ok', { from: new Date(seenBefore).toISOString(), to: now, days: jumpDays, source: trust === 'synced' ? 'ntp' : 'boot', guarded: false });
      }

      // Step 4: jobs. A running job was cut off; a queued data or USB job lost its password with tmpfs (V-004).
      const cut = db.all<{ id: string; lane: string; state: string; attempts: number; max_attempts: number }>("SELECT id, lane, state, attempts, max_attempts FROM job WHERE state IN ('running','queued')");
      for (const job of cut) {
        if (job.lane === 'media') {
          if (job.state === 'running') {
            if (job.attempts < job.max_attempts) db.run("UPDATE job SET state = 'queued', not_before = NULL WHERE id = ?", job.id);
            else db.run("UPDATE job SET state = 'failed', finished_at = ?, error_code = 'power_or_crash' WHERE id = ?", now, job.id);
          }
          continue;
        }
        db.run("UPDATE job SET state = 'interrupted', finished_at = ?, error_code = 'power_or_crash' WHERE id = ?", now, job.id);
        const exported = db.get<{ id: string }>("SELECT id FROM export WHERE job_id = ? AND state = 'preparing'", job.id);
        if (exported) {
          db.run("UPDATE export SET state = 'interrupted', error_code = 'power_or_crash' WHERE id = ?", exported.id);
          audit('export.interrupted', 'interrupted', { errorCode: 'power_or_crash' }, 'export', exported.id);
        }
      }
      // A preparing export without a live job cannot finish either.
      db.run("UPDATE export SET state = 'interrupted', error_code = 'power_or_crash' WHERE state = 'preparing'");

      // Step 7: ready exports. After an unclean stop they are re-hashed before anyone may download them (V-017).
      const ready = db.all<{ id: string; kind: string; state: string; file_name: string | null; size_bytes: number | null; ready_boot_seq: number | null }>(
        "SELECT id, kind, state, file_name, size_bytes, ready_boot_seq FROM export WHERE state IN ('ready','checking')",
      );
      for (const item of ready) {
        const file = item.file_name ? join(p.exports, item.file_name) : null;
        // Step 10: retention by boot count. A learner-data file never survives two boots; other kinds seven.
        const boots = bootSeq - (item.ready_boot_seq ?? bootSeq);
        const limit = item.kind === 'learner-data' ? 2 : 7;
        if (boots >= limit) {
          if (file) rmSync(file, { force: true });
          db.run("UPDATE export SET state = 'expired' WHERE id = ?", item.id);
          audit('export.expire', 'ok', { reason: 'boots' }, 'export', item.id);
          continue;
        }
        let size = -1;
        try {
          if (file) size = statSync(file).size;
        } catch {
          size = -1;
        }
        if (size !== item.size_bytes) {
          if (file) rmSync(file, { force: true });
          db.run("UPDATE export SET state = 'interrupted', error_code = 'file_lost' WHERE id = ?", item.id);
          audit('export.interrupted', 'interrupted', { errorCode: 'file_lost' }, 'export', item.id);
        } else if (!previousClean && item.state === 'ready') {
          db.run("UPDATE export SET state = 'checking' WHERE id = ?", item.id);
        }
        // An export still `checking` from an earlier boot stays so until maintenance has re-hashed it.
      }

      // Step 8: uploads that nobody continued for 24 h are given up.
      const stale = new Date(Date.now() - DAY).toISOString();
      db.run("UPDATE upload SET state = 'abandoned', updated_at = ? WHERE state = 'receiving' AND updated_at < ?", now, stale);

      // The Child protection mode is configuration; a change is audited (SYSTEM-ARCHITECTURE §10.3).
      const mode = config.childProtection.progressMode;
      const before = db.value<string>("SELECT value_json FROM setting WHERE key = 'child_protection.last_mode'");
      if (before !== JSON.stringify(mode)) {
        if (before !== undefined) audit('config.child_protection_mode', 'ok', { from: JSON.parse(before) as unknown, to: mode });
        db.run(
          "INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES ('child_protection.last_mode', ?, ?, 'system') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
          JSON.stringify(mode),
          now,
        );
      }

      db.run(
        'INSERT INTO boot (boot_id, started_at, previous_clean, clock_trust, recovery_note) VALUES (?, ?, ?, ?, ?) ON CONFLICT (boot_id) DO UPDATE SET recovery_note = excluded.recovery_note',
        bootId,
        startedAt,
        previousClean ? 1 : 0,
        trust === 'manual' ? 'unsure' : trust,
        notes.length > 0 ? notes.join(' ') : null,
      );
      return { bootId, bootSeq, uptimeBaseS, previousClean, startedAt };
    });

    // Step 6: everything in the temp folders is incomplete by definition.
    emptyDir(p.exportsTmp);
    emptyDir(join(p.snapshots, '.tmp'));
    emptyDir(p.jobsTmp);
    emptyDir(p.tmp);
    try {
      emptyDir(p.exportSecrets);
    } catch {
      // tmpfs is empty after a boot anyway
    }

    // Step 7 (files): a file in exports/ without a ready or checking row is never served; remove it.
    const wanted = new Set(db.all<{ file_name: string }>("SELECT file_name FROM export WHERE state IN ('ready','checking') AND file_name IS NOT NULL").map((r) => r.file_name));
    for (const name of safeList(p.exports)) {
      if (name === '.tmp' || wanted.has(name)) continue;
      removeQuietly(join(p.exports, name));
    }
    fsyncDir(p.exports);

    // Step 8 (files): the database value is the truth; cut each .part back to it so the phone can resume.
    const receiving = new Map(db.all<{ id: string; received_bytes: number }>("SELECT id, received_bytes FROM upload WHERE state = 'receiving'").map((r) => [r.id, r.received_bytes]));
    const processing = new Set(db.all<{ id: string }>("SELECT id FROM upload WHERE state = 'processing'").map((r) => r.id));
    for (const name of safeList(p.uploadsPartial)) {
      const id = name.replace(/\.part$/, '');
      const received = receiving.get(id);
      const file = join(p.uploadsPartial, name);
      if (received === undefined) {
        // The job of a 'processing' upload reads this file again when the worker retries it after the boot (BR-061).
        if (!processing.has(id)) removeQuietly(file);
        continue;
      }
      try {
        if (statSync(file).size > received) truncateSync(file, received);
      } catch {
        // unreadable: the next chunk request reports the mismatch
      }
    }
    // A receiving upload whose file is shorter than the database says (or missing) restarts from what is really there.
    for (const [id, received] of receiving) {
      let size = 0;
      try {
        size = statSync(join(p.uploadsPartial, `${id}.part`)).size;
      } catch {
        size = 0;
      }
      if (size < received) db.tx(() => db.run('UPDATE upload SET received_bytes = ?, updated_at = ? WHERE id = ?', size, now, id));
    }

    // Step 9: files in the store that the database does not know, older than 1 h, are moved aside.
    const orphans = moveOrphanBlobs(p, db);
    if (orphans > 0) notes.push(`${orphans} unknown media files were moved aside.`);

    if (!previousClean && info.bootSeq > 1) notes.push('The bag was not switched off safely last time.');
    if (notes.length > 0) db.tx(() => db.run('UPDATE boot SET recovery_note = ? WHERE boot_id = ?', notes.join(' '), bootId));

    writeClockState(p, { trust, handSetUnconfirmed: trust === 'manual', pending: null });
    const boot: BootInfo = { ...info, uptimeBaseS: info.uptimeBaseS };
    writeFileDurable(p.bootJson, JSON.stringify(boot), 0o600);
    rmSync(p.maintenanceFlag, { force: true });
    log('boot.recover', { result: 'ok', bootSeq: boot.bootSeq, previousClean, clockTrust: trust, day: dayOf() });
    return { boot, notes, maintenance: false, alreadyDone: false };
  } finally {
    main.close();
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** DATA-EXPORT §13 step 9. Returns how many files were moved to media/.orphans/. */
export function moveOrphanBlobs(p: Paths, db: Db): number {
  const known = new Set(db.all<{ rel_path: string }>('SELECT rel_path FROM blob').map((r) => r.rel_path));
  let moved = 0;
  for (const top of ['c', 'd']) {
    for (const shard of safeList(join(p.media, top))) {
      for (const name of safeList(join(p.media, top, shard))) {
        const rel = `${top}/${shard}/${name}`;
        if (known.has(rel)) continue;
        const file = join(p.media, rel);
        try {
          const s = statSync(file);
          if (!s.isFile() || Date.now() - s.mtimeMs < HOUR) continue;
          renameSync(file, join(p.mediaOrphans, `${Date.now()}-${name}`));
          moved += 1;
        } catch {
          // vanished
        }
      }
    }
  }
  if (moved > 0) fsyncDir(p.mediaOrphans);
  return moved;
}
