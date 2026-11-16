/*
 * Database snapshots (DATABASE §9.2, DATA-EXPORT §9): always VACUUM INTO (one
 * read transaction; never a copy of the live file), then fsync(file) → rename
 * → fsync(directory). Local snapshots are taken as a PAIR (main + counts)
 * with the same name stem and rotated together (V-025).
 */
import { closeSync, existsSync, fsyncSync, openSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from '../config.ts';
import { Db, checkDatabase } from '../core/db.ts';
import { ensureDir, fsyncDir } from '../core/fsx.ts';
import { DAY } from '../core/time.ts';

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** VACUUM INTO `dest` (which must not exist) and make it durable. */
export function vacuumInto(db: Db, dest: string): void {
  if (!/^[A-Za-z0-9_./ -]+$/.test(dest)) throw new Error('Unsafe snapshot path.');
  rmSync(dest, { force: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  fsyncPath(dest);
}

/** Open a snapshot read-only and run integrity_check. */
export function snapshotIsSound(file: string): boolean {
  try {
    const db = new Db(file, { role: 'batch', readOnly: true, skipWalAssert: true });
    try {
      return checkDatabase(db, true);
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export type SnapshotKind = 'auto' | 'pre-update' | 'pre-restore';

export interface SnapshotInfo {
  kind: SnapshotKind;
  /** File name of the main database snapshot. */
  name: string;
  path: string;
  countsPath: string | null;
  epoch: number;
  seq: number;
  /** Modification time of the file (ms). */
  mtimeMs: number;
  bytes: number;
}

const NAME = /^(auto|pre-update|pre-restore)-(\d+)-(\d+)-([0-9A-Za-z._-]+)\.sqlite3$/;

export function listSnapshots(p: Paths): SnapshotInfo[] {
  let names: string[];
  try {
    names = readdirSync(p.snapshots);
  } catch {
    return [];
  }
  const out: SnapshotInfo[] = [];
  for (const name of names) {
    const match = NAME.exec(name);
    if (!match || name.endsWith('.counts.sqlite3')) continue;
    const path = join(p.snapshots, name);
    const countsPath = path.replace(/\.sqlite3$/, '.counts.sqlite3');
    try {
      const s = statSync(path);
      out.push({ kind: match[1] as SnapshotKind, name, path, countsPath: existsSync(countsPath) ? countsPath : null, epoch: Number(match[2]), seq: Number(match[3]), mtimeMs: s.mtimeMs, bytes: s.size });
    } catch {
      // vanished
    }
  }
  // Newest first: by epoch, then change sequence (never by the wall clock alone).
  return out.sort((a, b) => b.epoch - a.epoch || b.seq - a.seq || b.mtimeMs - a.mtimeMs);
}

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').slice(0, 13);
}

/**
 * Take a snapshot pair. The copy is checked with integrity_check before it
 * gets its final name, so a file named auto-* is always complete and sound.
 */
export function takeSnapshotPair(p: Paths, main: Db, counts: Db | null, kind: SnapshotKind, label: string | null = null): SnapshotInfo {
  const tmpDir = join(p.snapshots, '.tmp');
  ensureDir(tmpDir);
  const epoch = Number(main.value("SELECT value FROM bag_meta WHERE key = 'epoch'") ?? 0);
  const seq = Number(main.value("SELECT value FROM bag_meta WHERE key = 'change_seq'") ?? 0);
  const stem = `${kind}-${epoch}-${seq}-${label ?? stamp(new Date())}`;
  const tmpMain = join(tmpDir, `${stem}.sqlite3`);
  const tmpCounts = join(tmpDir, `${stem}.counts.sqlite3`);
  vacuumInto(main, tmpMain);
  if (!snapshotIsSound(tmpMain)) {
    rmSync(tmpMain, { force: true });
    throw new Error('The snapshot did not pass integrity_check.');
  }
  const finalMain = join(p.snapshots, `${stem}.sqlite3`);
  const finalCounts = join(p.snapshots, `${stem}.counts.sqlite3`);
  let countsPath: string | null = null;
  if (counts) {
    vacuumInto(counts, tmpCounts);
    renameSync(tmpCounts, finalCounts);
    countsPath = finalCounts;
  }
  renameSync(tmpMain, finalMain);
  fsyncDir(p.snapshots);
  const s = statSync(finalMain);
  return { kind, name: `${stem}.sqlite3`, path: finalMain, countsPath, epoch, seq, mtimeMs: s.mtimeMs, bytes: s.size };
}

function remove(info: SnapshotInfo): void {
  rmSync(info.path, { force: true });
  if (info.countsPath) rmSync(info.countsPath, { force: true });
}

/**
 * Rotation (DATA-EXPORT §9): keep the newest 6 auto-*, plus the newest per
 * calendar day for at most 7 days; pre-update-* and pre-restore-* 30 days;
 * total capped at `capBytes`, oldest going first and never the newest.
 * Returns how many were removed.
 */
export function rotateSnapshots(p: Paths, capBytes: number, now = Date.now()): number {
  const all = listSnapshots(p);
  let removed = 0;
  const autos = all.filter((s) => s.kind === 'auto');
  const keep = new Set<string>(autos.slice(0, 6).map((s) => s.name));
  const seenDays = new Set<string>();
  for (const s of autos) {
    const day = new Date(s.mtimeMs).toISOString().slice(0, 10);
    if (now - s.mtimeMs <= 7 * DAY && !seenDays.has(day)) {
      seenDays.add(day);
      keep.add(s.name);
    }
  }
  for (const s of autos) {
    // The 6 newest are kept only while they are within 7 days too, except the very newest.
    const tooOld = now - s.mtimeMs > 7 * DAY && s.name !== autos[0]?.name;
    if (!keep.has(s.name) || tooOld) {
      remove(s);
      removed += 1;
    }
  }
  for (const s of all.filter((x) => x.kind !== 'auto')) {
    if (now - s.mtimeMs > 30 * DAY) {
      remove(s);
      removed += 1;
    }
  }
  let left = listSnapshots(p).filter((s) => s.kind === 'auto');
  let total = left.reduce((sum, s) => sum + s.bytes, 0);
  while (total > capBytes && left.length > 1) {
    const oldest = left[left.length - 1] as SnapshotInfo;
    remove(oldest);
    removed += 1;
    total -= oldest.bytes;
    left = left.slice(0, -1);
  }
  if (removed > 0) fsyncDir(p.snapshots);
  return removed;
}

/** Remove every auto-* snapshot (after "Remove learner data", so removed names do not stay in rotation copies). */
export function removeAutoSnapshots(p: Paths): number {
  const autos = listSnapshots(p).filter((s) => s.kind === 'auto');
  for (const s of autos) remove(s);
  if (autos.length > 0) fsyncDir(p.snapshots);
  return autos.length;
}
