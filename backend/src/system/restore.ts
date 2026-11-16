/*
 * Restore from a backup, and `new-epoch` (DATA-EXPORT §12, SYNC §3.2). A
 * technician's command, never an endpoint. It needs EasySTEM's private key
 * (an `age` identity on the technician's key stick): the bag cannot read its
 * own backups.
 *
 * Order (the live database is untouched until step 6):
 *   1. age -d → tar → restore/<id>/ ; verify the manifest's sizes and SHA-256s
 *   2. integrity_check; the backup's schema must not be newer than this release
 *   3. the office's highest imported epoch for this bag (signed registry, or
 *      --min-epoch, or the typed statement that no backup ever reached the office)
 *   4. summary and typed confirmation
 *   5. journal {step: prepared}; maintenance on; services stopped; safety snapshot
 *   6. replace_live_database (old -wal/-shm removed, new epoch above backup,
 *      bag and office, new nonce, counter lift); counts file swapped; {step: swapped}
 *   7. media reconciled; new bag secrets; audit; {step: done}; maintenance off
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Config, paths as buildPaths } from '../config.ts';
import { Db, checkDatabase } from '../core/db.ts';
import { fsyncDir, writeFileDurable } from '../core/fsx.ts';
import { headState, migrate } from '../core/migrate.ts';
import { epochOf, liftEpochInTx, readEpochFloor, removeDatabaseFiles, replaceLiveDatabase, writeEpochFloor } from '../core/replace.ts';
import { nowIso } from '../core/time.ts';
import { takeSnapshotPair } from '../exports/snapshots.ts';
import { createHash } from 'node:crypto';

export class RestoreRefused extends Error {}

interface Manifest {
  format: string;
  scope: string;
  backupId: string;
  bagId: string;
  bagName: string;
  createdAt: string;
  epoch: number;
  epochNonce: string;
  changeSeq: number;
  schemaHead: { main: string | null; counts: string | null };
  databases: Record<string, { sizeBytes: number; sha256: string }>;
  media: { sha256: string; size: number; ext: string }[];
}

/** Unpack a plain ustar archive (what the bag writes) into `dir`. Only the three known members are accepted. */
export function untarBackup(tarFile: string, dir: string): void {
  const allowed = new Set(['BACKUP-MANIFEST.json', 'db/sensebod-offline.sqlite3', 'db/counts.sqlite3']);
  untar(tarFile, dir, (name) => allowed.has(name));
}

/** Plain relative file names only: no "..", no absolute path, no backslash, no control characters. */
function safeMemberName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || name.startsWith('/') || /[\\\x00-\x1f]/.test(name)) return false;
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function untar(tarFile: string, dir: string, accept: (name: string) => boolean, served = false): void {
  const fd = openSync(tarFile, 'r');
  try {
    const header = Buffer.alloc(512);
    let position = 0;
    for (;;) {
      if (readSync(fd, header, 0, 512, position) < 512 || header.every((byte) => byte === 0)) break;
      position += 512;
      const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
      const name = (prefix ? `${prefix}/` : '') + header.toString('utf8', 0, 100).replace(/\0.*$/, '');
      const type = header.toString('ascii', 156, 157);
      const size = Number.parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim(), 8);
      if ((type !== '0' && type !== '\0') || !safeMemberName(name) || !accept(name) || !Number.isSafeInteger(size) || size < 0) throw new RestoreRefused(`The backup holds something unexpected (${name.slice(0, 40)}).`);
      const target = join(dir, name);
      // Lesson files are read by nginx; everything else in a backup is private.
      mkdirSync(dirname(target), { recursive: true, mode: served ? 0o755 : 0o700 });
      const out = openSync(target, 'w', served ? 0o644 : 0o600);
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        for (let left = size; left > 0; ) {
          const n = readSync(fd, buffer, 0, Math.min(buffer.length, left), position);
          if (n === 0) throw new RestoreRefused('The backup file is cut off.');
          for (let done = 0; done < n; ) done += writeSync(out, buffer, done, n - done);
          position += n;
          left -= n;
        }
      } finally {
        closeSync(out);
      }
      position += (512 - (size % 512)) % 512;
    }
  } finally {
    closeSync(fd);
  }
}

function hashOf(file: string): { sha256: string; sizeBytes: number } {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  let size = 0;
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      size += n;
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return { sha256: hash.digest('hex'), sizeBytes: size };
}

export interface RestoreOptions {
  /** A decrypted backup (.tar). The CLI decrypts with `age -d -i <identity>` first. */
  tarFile: string;
  /** The office's highest imported epoch for this bag; null = the technician stated that no backup ever reached the office. */
  minEpoch: number | null;
  /** SENSEBOD-OFFLINE/<bag id>/media on the stick of a full backup, to copy missing lesson files from. */
  mediaDir?: string;
  /** Called with the summary; returns true to go on (the CLI asks for a typed RESTORE). */
  confirm: (summary: RestoreSummary) => boolean;
  /** Stop and start the services (systemctl); a no-op in tests and with dev.fake_privileged. */
  services?: { stop(): void; start(): void };
}

export interface RestoreSummary {
  bagId: string;
  bagName: string;
  backupCreatedAt: string;
  learnersInBackup: number;
  lessonsInBackup: number;
  learnersOnlyOnBag: number;
  missingMedia: number;
  newEpoch: number;
}

export interface RestoreReport extends RestoreSummary {
  lessonsUnpublished: string[];
  mediaCopied: number;
}

export function restoreBackup(config: Config, options: RestoreOptions): RestoreReport {
  const p = buildPaths(config);
  const id = `r-${Date.now().toString(36)}`;
  const work = join(p.restore, id);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const stateFile = join(p.restore, 'state.json');
  // A journal that is already there belongs to a restore that was cut after it began to change the bag:
  // a run that stops early must leave it, and the closed bag, as they are (BR-063).
  const unfinished = existsSync(stateFile);
  let swapped = false;
  try {
    // 1. unpack and verify
    untarBackup(options.tarFile, work);
    const manifest = JSON.parse(readFileSync(join(work, 'BACKUP-MANIFEST.json'), 'utf8')) as Manifest;
    if (manifest.format !== 'sensebod-offline-backup/1') throw new RestoreRefused('This is not a Sensebod Offline backup.');
    const newMain = join(work, 'db', 'sensebod-offline.sqlite3');
    const newCounts = join(work, 'db', 'counts.sqlite3');
    for (const [name, file] of [['db/sensebod-offline.sqlite3', newMain], ['db/counts.sqlite3', newCounts]] as const) {
      const want = manifest.databases[name];
      const got = existsSync(file) ? hashOf(file) : null;
      if (!want || !got || got.sha256 !== want.sha256 || got.sizeBytes !== want.sizeBytes) throw new RestoreRefused(`${name} in the backup is damaged (its check code does not match).`);
    }
    // 2. sound, and not from a newer release
    const incoming = new Db(newMain, { role: 'batch', skipWalAssert: true });
    let learnersInBackup = 0;
    let lessonsInBackup = 0;
    let backupLearnerIds = new Set<string>();
    try {
      if (!checkDatabase(incoming, true)) throw new RestoreRefused('The database in the backup is damaged.');
      const state = headState(incoming, 'main');
      if (state === 'ahead') throw new RestoreRefused('This backup was made by a newer version of Sensebod Offline. Update the bag first.');
      learnersInBackup = Number(incoming.value('SELECT count(*) FROM learner') ?? 0);
      lessonsInBackup = Number(incoming.value('SELECT count(*) FROM lesson') ?? 0);
      backupLearnerIds = new Set(incoming.all<{ id: string }>('SELECT id FROM learner').map((r) => r.id));
    } finally {
      incoming.close();
    }
    // What is on the bag now (it may be a fresh card, or a damaged one).
    let currentEpoch = Math.max(epochOf(p.mainDb), readEpochFloor(p.mainDb));
    let learnersOnlyOnBag = 0;
    let current: Db | null = null;
    try {
      if (existsSync(p.mainDb)) {
        current = new Db(p.mainDb, { role: 'batch' });
        learnersOnlyOnBag = current.all<{ id: string }>('SELECT id FROM learner').filter((r) => !backupLearnerIds.has(r.id)).length;
      }
    } catch {
      current = null;
    }
    // 3. the new lineage must sort after everything the office has seen (V-008)
    const floor = Math.max(manifest.epoch, currentEpoch, options.minEpoch ?? 0);
    const missing = manifest.media.filter((blob) => !existsSync(join(p.media, 'c', blob.sha256.slice(0, 2), `${blob.sha256}.${blob.ext}`)) && !existsSync(join(p.media, 'd', blob.sha256.slice(0, 2), `${blob.sha256}.${blob.ext}`)));
    const summary: RestoreSummary = {
      bagId: manifest.bagId,
      bagName: manifest.bagName,
      backupCreatedAt: manifest.createdAt,
      learnersInBackup,
      lessonsInBackup,
      learnersOnlyOnBag,
      missingMedia: missing.length,
      newEpoch: floor + 1,
    };
    // 4. the technician decides
    if (!options.confirm(summary)) {
      current?.close();
      throw new RestoreRefused('Restore was not confirmed. Nothing was changed.');
    }
    // 5. journal, maintenance, services, safety snapshot of what is there now
    writeFileDurable(stateFile, JSON.stringify({ id, step: 'prepared', at: nowIso() }), 0o600);
    try {
      writeFileSync(p.maintenanceFlag, 'restore\n');
    } catch {
      // /run may not be writable for this user; the services are stopped anyway
    }
    options.services?.stop();
    if (current) {
      try {
        if (checkDatabase(current)) {
          let counts: Db | null = null;
          try {
            counts = existsSync(p.countsDb) ? new Db(p.countsDb, { role: 'batch' }) : null;
          } catch {
            counts = null;
          }
          takeSnapshotPair(p, current, counts, 'pre-restore', id);
          counts?.close();
        }
        current.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        // a damaged database cannot be snapshotted; it is moved aside below instead
      }
      current.close();
    }
    // 6. the swap, through the one routine every replacement uses. From here on the bag stays closed until a restore completes.
    swapped = true;
    writeFileDurable(stateFile, JSON.stringify({ id, step: 'swapping', at: nowIso() }), 0o600);
    const newEpoch = replaceLiveDatabase({ dbPath: p.mainDb, source: newMain, asideDir: join(p.dbDir, `replaced-${id}`), minEpoch: floor, restoredFrom: `backup of ${manifest.createdAt.slice(0, 10)}` });
    removeDatabaseFiles(p.countsDb, null);
    copyFileSync(newCounts, p.countsDb);
    fsyncDir(p.dbDir);
    const counts = new Db(p.countsDb, { role: 'batch', skipWalAssert: true });
    counts.exec('PRAGMA journal_mode=WAL');
    migrate(counts, 'counts');
    counts.close();
    writeFileDurable(stateFile, JSON.stringify({ id, step: 'swapped', at: nowIso() }), 0o600);

    // 7. media, secrets, audit
    let mediaCopied = 0;
    if (options.mediaDir) {
      for (const blob of missing) {
        const source = join(options.mediaDir, blob.sha256.slice(0, 2), `${blob.sha256}.${blob.ext}`);
        if (!existsSync(source) || hashOf(source).sha256 !== blob.sha256) continue;
        const db = new Db(p.mainDb, { role: 'batch' });
        const rel = db.value<string>('SELECT rel_path FROM blob WHERE sha256 = ?', blob.sha256);
        db.close();
        if (!rel) continue;
        mkdirSync(dirname(join(p.media, rel)), { recursive: true, mode: 0o755 });
        copyFileSync(source, join(p.media, rel));
        mediaCopied += 1;
      }
    }
    const db = new Db(p.mainDb, { role: 'batch' });
    let lessonsUnpublished: string[] = [];
    try {
      // Animation packages travel as <stick>/tryit/<folder>.tar next to media/ (BR-065).
      const packages = db.all<{ dir_name: string; lesson_id: string | null }>('SELECT dir_name, lesson_id FROM tryit_package ORDER BY created_at');
      const packagesGone = new Map<string, boolean>();
      for (const pack of packages) {
        const target = join(p.tryit, pack.dir_name);
        const tar = options.mediaDir ? join(dirname(options.mediaDir), 'tryit', `${pack.dir_name}.tar`) : '';
        if (!existsSync(target) && /^[A-Za-z0-9_-]{1,80}$/.test(pack.dir_name) && tar && existsSync(tar)) {
          const tmp = `${target}.restoring`;
          rmSync(tmp, { recursive: true, force: true });
          try {
            mkdirSync(tmp, { recursive: true, mode: 0o755 });
            untar(tar, tmp, () => true, true);
            renameSync(tmp, target);
            fsyncDir(p.tryit);
          } catch {
            rmSync(tmp, { recursive: true, force: true });
          }
        }
        // The newest package of a lesson is the one it shows.
        if (pack.lesson_id) packagesGone.set(pack.lesson_id, !existsSync(join(target, 'index.html')));
      }
      const lessonsWithoutPackage = [...packagesGone].filter(([, gone]) => gone).map(([lessonId]) => lessonId);
      const rows = db.all<{ sha256: string; rel_path: string }>('SELECT sha256, rel_path FROM blob');
      const gone = rows.filter((row) => !existsSync(join(p.media, row.rel_path))).map((row) => row.sha256);
      db.tx(() => {
        const seq = (): number => Number((db.get<{ value: string }>("UPDATE bag_meta SET value = value + 1 WHERE key = 'change_seq' RETURNING value") as { value: string }).value);
        // A lesson whose files did not come back is unpublished with a note; it is never shown broken (D-2.4).
        if (gone.length > 0) {
          const marks = gone.map(() => '?').join(',');
          lessonsUnpublished = db.all<{ id: string }>(`SELECT DISTINCT l.id FROM lesson l JOIN lesson_asset a ON a.lesson_id = l.id WHERE l.status = 'published' AND a.blob_sha256 IN (${marks})`, ...gone).map((r) => r.id);
          for (const lessonId of lessonsUnpublished) {
            db.run("UPDATE lesson SET status = 'draft', body_json = json_set(body_json, '$.mediaNote', 'The file of this lesson did not come back with the restore. Upload it again.'), version = version + 1, updated_at = ?, seq = ? WHERE id = ?", nowIso(), seq(), lessonId);
          }
        }
        for (const lessonId of lessonsWithoutPackage) {
          if (lessonsUnpublished.includes(lessonId) || !db.get("SELECT 1 FROM lesson WHERE id = ? AND status = 'published'", lessonId)) continue;
          db.run("UPDATE lesson SET status = 'draft', body_json = json_set(body_json, '$.mediaNote', 'The animation of this lesson did not come back with the restore. Upload it again.'), version = version + 1, updated_at = ?, seq = ? WHERE id = ?", nowIso(), seq(), lessonId);
          lessonsUnpublished.push(lessonId);
        }
        db.run("UPDATE bag_meta SET value = value + 1 WHERE key = 'content_rev'");
        db.run('DELETE FROM admin_session');
        db.run("UPDATE job SET state = 'interrupted', error_code = 'power_or_crash', finished_at = ? WHERE state IN ('queued','running')", nowIso());
        db.run("UPDATE export SET state = 'expired' WHERE state IN ('preparing','ready','checking')");
        db.run(
          "INSERT INTO audit_event (at, boot_id, clock_trust, actor_id, actor_name, action, target_type, target_id, outcome, detail_json) VALUES (?, 'restore', 'unsure', 'technician-cli', 'technician-cli', 'restore', 'backup', ?, 'ok', ?)",
          nowIso(),
          manifest.backupId,
          JSON.stringify({ backupDate: manifest.createdAt, learnersLost: learnersOnlyOnBag, newEpoch, minEpoch: options.minEpoch, officeRecord: options.minEpoch !== null, lessonsUnpublished: lessonsUnpublished.length, mediaCopied }),
        );
      });
    } finally {
      db.close();
    }
    // Bag secrets are not in a backup: tickets and sessions of the old card must not work on this one.
    writeFileDurable(join(p.keys, 'ticket.key'), randomBytes(32), 0o600);
    writeFileDurable(join(p.keys, 'session.pepper'), randomBytes(32), 0o600);
    // boot.json describes a boot of the replaced database; boot recovery writes a new one.
    rmSync(p.bootJson, { force: true });
    writeFileDurable(stateFile, JSON.stringify({ id, step: 'done', at: nowIso() }), 0o600);
    const report: RestoreReport = { ...summary, newEpoch, lessonsUnpublished, mediaCopied };
    writeFileSync(join(work, 'report.txt'), `${JSON.stringify(report, null, 2)}\n`);
    for (const name of ['db/sensebod-offline.sqlite3', 'db/counts.sqlite3']) rmSync(join(work, name), { force: true });
    rmSync(stateFile, { force: true });
    rmSync(p.maintenanceFlag, { force: true });
    options.services?.start();
    return report;
  } catch (error) {
    // Before the swap nothing was changed: discard the extracted files and reopen the bag.
    if (!swapped) {
      rmSync(work, { recursive: true, force: true });
      if (!unfinished) {
        rmSync(stateFile, { force: true });
        rmSync(p.maintenanceFlag, { force: true });
        try {
          options.services?.start();
        } catch {
          // reported by the caller
        }
      }
    }
    throw error;
  }
}

/* ---- the signed registry of the office (SYNC §3.2) ---- */

/** The office's highest imported epoch for a bag, from a bag-registry.json whose OpenSSH signature verifies. */
export function minEpochFromRegistry(config: Config, registryFile: string, bagId: string): number {
  const result = spawnSync(config.tools.sshKeygen, ['-Y', 'verify', '-f', config.paths.allowedSignersFile, '-I', 'registry@easystem', '-n', 'sensebod-offline-registry', '-s', `${registryFile}.sig`], {
    input: readFileSync(registryFile),
    timeout: 20_000,
  });
  if (result.status !== 0) throw new RestoreRefused('The bag registry is not signed by EasySTEM. Use the registry from the office, or --min-epoch.');
  const registry = JSON.parse(readFileSync(registryFile, 'utf8')) as { bags?: { bagId: string; epoch: number; revoked?: boolean }[] };
  const entry = (registry.bags ?? []).find((bag) => bag.bagId === bagId);
  if (!entry) throw new RestoreRefused('The bag registry does not list this bag. Use --min-epoch from the office, or --no-office-record.');
  if (entry.revoked) throw new RestoreRefused('The office marked this bag as revoked.');
  return entry.epoch;
}

/** Peek at the manifest of a decrypted backup without unpacking the databases. */
export function manifestOf(tarFile: string): { bagId: string; bagName: string; createdAt: string; epoch: number } {
  const text = execFileSync('tar', ['-xOf', tarFile, 'BACKUP-MANIFEST.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(text) as { bagId: string; bagName: string; createdAt: string; epoch: number };
}

/**
 * `new-epoch` (SYNC §3.2, V-029): move the live database to a new epoch
 * WITHOUT restoring anything, and re-stamp every row and tombstone changed in
 * the current lineage with fresh sequence numbers, in their original order,
 * so the office imports them under the new epoch. One transaction.
 */
export function newEpoch(config: Config, minEpoch: number): { epoch: number; restamped: number } {
  const p = buildPaths(config);
  const db = new Db(p.mainDb, { role: 'batch' });
  try {
    const base = Number(db.value("SELECT value FROM bag_meta WHERE key = 'epoch_base_seq'") ?? 0);
    const tables: [string, string][] = [
      ['learner', 'id'],
      ['lesson_progress', "learner_id || '|' || lesson_id"],
      ['lesson', 'id'],
      ['series', 'id'],
      ['content_group', 'id'],
      ['portal', 'id'],
      ['picture', 'id'],
      ['admin_account', 'id'],
      ['tombstone', "entity || '|' || entity_id"],
    ];
    const changed: { table: string; key: string; rowid: number; seq: number }[] = [];
    for (const [table, key] of tables) {
      for (const row of db.all<{ rowid: number; key: string; seq: number }>(`SELECT rowid, ${key} AS key, seq FROM ${table} WHERE seq > ?`, base)) changed.push({ table, key: row.key, rowid: row.rowid, seq: row.seq });
    }
    changed.sort((a, b) => a.seq - b.seq);
    // Epoch, nonce, counter lift and the re-stamp are ONE transaction: a power cut leaves all of it or none.
    const epoch = db.tx(() => {
      const next = liftEpochInTx(db, Math.max(minEpoch, readEpochFloor(p.mainDb)), null);
      for (const row of changed) {
        const seq = Number((db.get<{ value: string }>("UPDATE bag_meta SET value = value + 1 WHERE key = 'change_seq' RETURNING value") as { value: string }).value);
        db.run(`UPDATE ${row.table} SET seq = ? WHERE rowid = ?`, seq, row.rowid);
      }
      db.run(
        "INSERT INTO audit_event (at, boot_id, clock_trust, actor_id, actor_name, action, outcome, detail_json) VALUES (?, 'cli', 'unsure', 'technician-cli', 'technician-cli', 'epoch.new', 'ok', ?)",
        nowIso(),
        JSON.stringify({ epoch: next, restamped: changed.length, minEpoch }),
      );
      return next;
    });
    writeEpochFloor(p.mainDb, epoch);
    return { epoch, restamped: changed.length };
  } finally {
    db.close();
  }
}

