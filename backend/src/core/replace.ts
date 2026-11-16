/*
 * replace_live_database (SYNC §3.2, DATABASE §9.3, DATA-EXPORT §12).
 *
 * EVERY path that swaps the live database file goes through this routine:
 * automatic recovery from a local snapshot, restore of a pre-update snapshot,
 * and the technician's restore from a backup. It
 *   - moves or removes the old file together with its -wal and -shm (a stale
 *     -wal next to a swapped-in file would be replayed onto it),
 *   - copies the new file into place durably (temp → fsync → rename → fsync dir),
 *   - increments the epoch, sets a new random epoch_nonce, and lifts the
 *     change counter to max(change_seq, epoch × 2^40), so every change made
 *     after a replacement sorts after anything stamped before it.
 *
 * It must run with the API and the worker stopped.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { Db } from './db.ts';
import { fsyncDir, writeFileDurable } from './fsx.ts';
import { fsyncSync, openSync, closeSync } from 'node:fs';
import { migrate } from './migrate.ts';

const EPOCH_SPAN = 2 ** 40;

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Move a database file and its -wal / -shm into `asideDir`, or delete them when no directory is given. */
export function removeDatabaseFiles(dbPath: string, asideDir: string | null): void {
  if (asideDir) mkdirSync(asideDir, { recursive: true, mode: 0o700 });
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix;
    if (!existsSync(file)) continue;
    if (asideDir) renameSync(file, join(asideDir, basename(file)));
    else rmSync(file, { force: true });
  }
  fsyncDir(dirname(dbPath));
  if (asideDir) fsyncDir(asideDir);
}

/** Copy `source` into place as `dbPath` so that a power cut leaves either no file or the whole file. */
export function installDatabaseFile(source: string, dbPath: string): void {
  const tmp = dbPath + '.incoming';
  rmSync(tmp, { force: true });
  copyFileSync(source, tmp);
  fsyncPath(tmp);
  renameSync(tmp, dbPath);
  fsyncDir(dirname(dbPath));
}

/**
 * New epoch + nonce + counter lift, in one transaction on an open connection.
 * Also used alone by `sensebod-offline-admin new-epoch`. Returns the new epoch.
 */
export function liftEpoch(db: Db, minEpoch: number, restoredFrom: string | null): number {
  return db.tx(() => liftEpochInTx(db, minEpoch, restoredFrom));
}

/** The same, inside a transaction the caller already opened (new-epoch re-stamps rows in that same transaction). */
export function liftEpochInTx(db: Db, minEpoch: number, restoredFrom: string | null): number {
  {
    const read = (key: string): number => Number(db.value('SELECT value FROM bag_meta WHERE key = ?', key) ?? 0);
    const set = (key: string, value: string): void => {
      db.run('INSERT INTO bag_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    };
    const epoch = Math.max(read('epoch'), minEpoch) + 1;
    const seq = Math.max(read('change_seq'), epoch * EPOCH_SPAN);
    set('epoch', String(epoch));
    set('epoch_nonce', randomBytes(16).toString('hex'));
    set('change_seq', String(seq));
    set('epoch_base_seq', String(seq));
    if (restoredFrom !== null) set('restored_from', restoredFrom);
    // Sessions of the old lineage must not survive into the new one.
    db.run('DELETE FROM admin_session');
    // Open override requests belong to the old lineage; they are void now (ADR-017).
    db.run("UPDATE override_request SET state = 'void' WHERE state IN ('open','waiting-for-easystem','code-received','send-failed','declined')");
    return epoch;
  }
}

export interface ReplaceOptions {
  /** The live database path. */
  dbPath: string;
  /** A complete, checked SQLite file to become the live database. */
  source: string;
  /** Where the old files go (e.g. db/corrupt-<boot id>); null deletes them. */
  asideDir: string | null;
  /** The new epoch is greater than this, the source's own epoch and the bag's previous epoch. */
  minEpoch: number;
  /** Plain words for bag_meta.restored_from (shown to admins). */
  restoredFrom: string;
}

/** Being copied and lifted: never used by anyone else. */
export const incomingPath = (dbPath: string): string => dbPath + '.incoming';
/** Complete, migrated, on its new epoch and fsynced: the only file boot recovery may finish (it gets this name last). */
export const stagedPath = (dbPath: string): string => dbPath + '.staged';
const floorPath = (dbPath: string): string => join(dirname(dbPath), 'epoch.floor');

/**
 * The highest epoch this card has ever given out, kept beside the database.
 * A second recovery from the same snapshot must not reuse the epoch of the
 * first: the snapshot's own epoch is older than the lineage that just died.
 */
export function readEpochFloor(dbPath: string): number {
  try {
    const value = Number(readFileSync(floorPath(dbPath), 'utf8').trim());
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeEpochFloor(dbPath: string, epoch: number): void {
  if (epoch > readEpochFloor(dbPath)) writeFileDurable(floorPath(dbPath), String(epoch), 0o600);
}

/**
 * Returns the new epoch. Order, so that no failure or power cut leaves the
 * bag without a database or with a replaced database on an old epoch:
 *
 *   1. copy the source to `<db>.incoming` and fsync it      (live file untouched)
 *   2. migrate it and lift its epoch                         (live file untouched)
 *   3. record the epoch floor
 *   4. rename `.incoming` to `.staged` (the name that says "complete and lifted")
 *   5. move the old file, -wal and -shm away
 *   6. rename `.staged` into place, fsync the directory
 *   7. switch the new live file to WAL
 *
 * A cut before 5 leaves the old database and a leftover that boot recovery
 * removes. A cut between 5 and 6 leaves only `.staged`, which boot recovery
 * renames into place. A cut between 6 and 7 leaves a sound database in
 * rollback-journal mode, which boot recovery switches to WAL.
 */
export function replaceLiveDatabase(options: ReplaceOptions): number {
  const incoming = incomingPath(options.dbPath);
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(incoming + suffix, { force: true });
  copyFileSync(options.source, incoming);
  let epoch: number;
  const staged = new Db(incoming, { role: 'batch', skipWalAssert: true });
  try {
    // Stay in rollback-journal mode while staging: one file, no -wal to carry across the rename.
    staged.exec('PRAGMA journal_mode=DELETE');
    migrate(staged, 'main');
    epoch = liftEpoch(staged, Math.max(options.minEpoch, readEpochFloor(options.dbPath)), options.restoredFrom);
  } finally {
    staged.close();
  }
  fsyncPath(incoming);
  writeEpochFloor(options.dbPath, epoch);
  // The name `.staged` says "lifted and durable". A power cut before this rename leaves only `.incoming`, which is discarded.
  renameSync(incoming, stagedPath(options.dbPath));
  fsyncDir(dirname(options.dbPath));
  removeDatabaseFiles(options.dbPath, options.asideDir);
  finishIncoming(options.dbPath);
  return epoch;
}

/** Steps 5–6. Also called by boot recovery when it finds a staged file and no live database. */
export function finishIncoming(dbPath: string): void {
  // A -wal left by the replaced database would be replayed onto the new file when it is opened (BR-062).
  for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  renameSync(stagedPath(dbPath), dbPath);
  fsyncDir(dirname(dbPath));
  const db = new Db(dbPath, { role: 'batch', skipWalAssert: true });
  try {
    db.exec('PRAGMA journal_mode=WAL');
  } finally {
    db.close();
  }
}

/** The epoch recorded in a database file (0 if it cannot be read). */
export function epochOf(dbPath: string): number {
  try {
    const db = new Db(dbPath, { role: 'batch', readOnly: true, skipWalAssert: true });
    try {
      return Number(db.value("SELECT value FROM bag_meta WHERE key = 'epoch'") ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}
