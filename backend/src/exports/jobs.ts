/*
 * Export jobs (DATA-EXPORT §3–§5, §10–§11): learner-data zip, records backup,
 * full backup to a stick, diagnostics, stick check and stick format.
 *
 * Every job follows the same order:
 *   1. VACUUM INTO snapshots of both databases in exports/.tmp/<export id>/, fsync
 *   2. the database connection is CLOSED; everything else reads the snapshot (V-024)
 *   3. the file is built as .part, fsynced, renamed into exports/ (or onto the
 *      stick as .partial → rename), the directory fsynced
 *   4. the result goes back to the supervisor, which commits the row
 * A file without a `ready` row is never served and is deleted at boot.
 * The scratch folder and the one-time password file are removed whatever
 * happens.
 */
import { spawn } from 'node:child_process';
import { closeSync, createReadStream, createWriteStream, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { bootUptimeS, type Ctx, type Tx } from '../core/context.ts';
import { Db } from '../core/db.ts';
import { fsyncDir, removeQuietly } from '../core/fsx.ts';
import { LEARNER_ID_ANYWHERE, sha256Hex } from '../core/ids.ts';
import { appliedMigrations } from '../core/migrate.ts';
import { HOUR, nowIso } from '../core/time.ts';
import { hashFile } from '../media/store.ts';
import { dropRequest, nonce, startUnit, writeRequest } from '../system/privileged.ts';
import { VERSION } from '../version.ts';
import { payloadOf, type JobRow } from '../worker/queue.ts';
import { JobFailure, type AfterCommit, type Handler, type JobEnv } from '../worker/types.ts';
import { ZipWriter, csvFile, writeTar, type TarMember } from './archive.ts';
import { vacuumInto } from './snapshots.ts';

interface ExportPayload {
  exportId: string;
  destination: 'download' | 'usb';
  options: { includeNames: boolean; includeChildProtectionCounts: boolean; encrypted: boolean; namesOverWifi: boolean; from: string | null; to: string | null };
}

interface ExportResult {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  rowCounts: Record<string, number>;
  snapshotSeq: number;
  usbPath: string | null;
  detail: Record<string, unknown>;
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'bag';
const stamp = (at: Date): string => at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);

/** Turn a filesystem error on the stick or the card into the export's error code. */
function fileFailure(error: unknown, onStick: boolean): JobFailure | null {
  const code = (error as { code?: string }).code;
  if (code === 'ENOSPC') return new JobFailure(onStick ? 'usb_full' : 'no_space', onStick ? 'The stick is full.' : 'Not enough space on the bag.');
  if (onStick && (code === 'EIO' || code === 'ENODEV' || code === 'ENOENT' || code === 'EROFS' || code === 'ENXIO' || code === 'ENOTCONN')) return new JobFailure('usb_removed', 'The stick was taken out too early.');
  return null;
}

interface Snapshots {
  dir: string;
  main: string;
  counts: string;
  seq: number;
  epoch: number;
  epochNonce: string;
  bagId: string;
  bagName: string;
}

/** Step 1 and 2: snapshot both databases, then hold no connection to the live files. */
function takeSnapshots(env: JobEnv, exportId: string): Snapshots {
  const dir = join(env.paths.exportsTmp, exportId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const main = join(dir, 'snapshot.sqlite3');
  const counts = join(dir, 'counts.sqlite3');
  const live = new Db(env.paths.mainDb, { role: 'batch' });
  try {
    vacuumInto(live, main);
  } finally {
    live.close();
  }
  const liveCounts = new Db(env.paths.countsDb, { role: 'batch' });
  try {
    vacuumInto(liveCounts, counts);
  } finally {
    liveCounts.close();
  }
  const snap = new Db(main, { role: 'batch', readOnly: true, skipWalAssert: true });
  try {
    const meta = (key: string): string => String(snap.value('SELECT value FROM bag_meta WHERE key = ?', key) ?? '');
    return { dir, main, counts, seq: Number(meta('change_seq')), epoch: Number(meta('epoch')), epochNonce: meta('epoch_nonce'), bagId: meta('bag_id'), bagName: meta('bag_name') || env.config.bag.name };
  } finally {
    snap.close();
  }
}

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Step 3 for a download: the finished .part becomes a file in exports/ by rename only. */
function publishOnBag(env: JobEnv, part: string, fileName: string): void {
  fsyncPath(part);
  renameSync(part, join(env.paths.exports, fileName));
  fsyncDir(env.paths.exports);
}

/** Copy a finished file onto the stick as <name>.partial → fsync → rename → fsync dir (DATA-EXPORT §10.2). */
async function copyToStick(source: string, target: string, onBytes?: (bytes: number) => void): Promise<void> {
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  try {
    const out = createWriteStream(partial, { flags: 'w' });
    const input = createReadStream(source, { highWaterMark: 1024 * 1024 });
    if (onBytes) input.on('data', (chunk) => onBytes(chunk.length));
    await pipeline(input, out);
    fsyncPath(partial);
    renameSync(partial, target);
    fsyncDir(dirname(target));
  } catch (error) {
    throw fileFailure(error, true) ?? error;
  }
}

function stickRoot(env: JobEnv): string {
  if (!existsSync(env.paths.usbMount)) throw new JobFailure('usb_removed', 'There is no stick in the bag.');
  return join(env.paths.usbMount, 'SENSEBOD-OFFLINE');
}

function writeStickFile(target: string, data: string): void {
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.partial`, data);
    fsyncPath(`${target}.partial`);
    renameSync(`${target}.partial`, target);
    fsyncDir(dirname(target));
  } catch (error) {
    throw fileFailure(error, true) ?? error;
  }
}

/* ------------------------------------------------------------------ */
/* supervisor side, shared                                             */
/* ------------------------------------------------------------------ */

const TTL_HOURS: Record<string, (ctx: Ctx) => number> = {
  'learner-data': (ctx) => ctx.config.exports.learnerTtlHours,
  'backup-records': (ctx) => ctx.config.exports.backupTtlHours,
  diagnostics: (ctx) => ctx.config.exports.diagnosticsTtlHours,
};

function cleanup(ctx: Ctx, exportId: string): void {
  removeQuietly(join(ctx.paths.exportsTmp, exportId));
  removeQuietly(join(ctx.paths.exportSecrets, exportId));
}

function finalizeExport(ctx: Ctx, tx: Tx, job: JobRow, raw: unknown): AfterCommit {
  const result = raw as ExportResult;
  const payload = payloadOf<ExportPayload>(job);
  const row = tx.get<{ kind: string; state: string; created_by: string }>('SELECT kind, state, created_by FROM export WHERE id = ?', payload.exportId);
  if (!row || row.state !== 'preparing') {
    // The export was given up meanwhile (boot recovery, delete): the file must not stay.
    return () => {
      if (payload.destination === 'download') removeQuietly(join(ctx.paths.exports, result.fileName));
      cleanup(ctx, payload.exportId);
    };
  }
  const now = nowIso();
  const onStick = payload.destination === 'usb';
  const ttl = TTL_HOURS[row.kind];
  tx.run(
    `UPDATE export SET state = ?, ready_at = ?, ready_boot_id = ?, ready_boot_seq = ?, ready_uptime_s = ?, expires_at = ?, file_name = ?, size_bytes = ?, sha256 = ?,
            snapshot_seq = ?, row_counts_json = ?, usb_path = ?, error_code = NULL WHERE id = ?`,
    onStick ? 'copied-to-usb' : 'ready',
    now,
    ctx.boot.bootId,
    ctx.boot.bootSeq,
    bootUptimeS(),
    onStick || !ttl ? null : new Date(Date.now() + ttl(ctx) * HOUR).toISOString(),
    result.fileName,
    result.sizeBytes,
    result.sha256,
    result.snapshotSeq,
    JSON.stringify(result.rowCounts),
    result.usbPath,
    payload.exportId,
  );
  tx.audit({ actorId: row.created_by, action: 'export.ready', targetType: 'export', targetId: payload.exportId, detail: { kind: row.kind, destination: payload.destination, sizeBytes: result.sizeBytes, rowCounts: result.rowCounts } });
  if (onStick && row.kind !== 'learner-data' && row.kind !== 'diagnostics') tx.audit({ actorId: row.created_by, action: 'backup.usb', targetType: 'export', targetId: payload.exportId, detail: result.detail });
  if (row.kind === 'backup-full' && typeof result.detail.stickLabel === 'string') {
    tx.run(
      "INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES ('usb.last_full_backup_label', ?, ?, 'system') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      JSON.stringify(result.detail.stickLabel),
      now,
    );
  }
  return () => cleanup(ctx, payload.exportId);
}

const EXPORT_CODES = ['power_or_crash', 'worker_restart', 'stalled', 'password_missing', 'no_space', 'usb_removed', 'usb_full', 'file_lost', 'internal'];

function failedExport(ctx: Ctx, tx: Tx, job: JobRow, state: 'failed' | 'interrupted', code: string): AfterCommit {
  const payload = payloadOf<ExportPayload>(job);
  const errorCode = EXPORT_CODES.indexOf(code) === -1 ? 'internal' : code;
  const changed = tx.run("UPDATE export SET state = ?, error_code = ? WHERE id = ? AND state = 'preparing'", state, errorCode, payload.exportId);
  if (changed === 1) tx.audit({ actorId: 'system', actorName: 'system', action: state === 'failed' ? 'export.failed' : 'export.interrupted', targetType: 'export', targetId: payload.exportId, outcome: state, detail: { errorCode, reason: code } });
  return () => cleanup(ctx, payload.exportId);
}

function exportHandler(lane: 'data' | 'usb', run: (env: JobEnv, payload: ExportPayload) => Promise<ExportResult>): Handler {
  return {
    lane,
    async run(env) {
      const payload = env.job.payload as unknown as ExportPayload;
      try {
        return await run(env, payload);
      } catch (error) {
        throw fileFailure(error, false) ?? error;
      } finally {
        // The scratch folder (it holds a snapshot with names) and the password never outlive the job.
        removeQuietly(join(env.paths.exportsTmp, payload.exportId));
        removeQuietly(join(env.paths.exportSecrets, payload.exportId));
      }
    },
    finalize: finalizeExport,
    failed: failedExport,
  };
}

/** Move a finished file to where it goes: exports/ on the bag, or SENSEBOD-OFFLINE/… on the stick with a .sha256 beside it. */
async function deliver(env: JobEnv, payload: ExportPayload, part: string, fileName: string, stickFolder: string): Promise<{ sizeBytes: number; sha256: string; usbPath: string | null }> {
  fsyncPath(part);
  const { sha256, sizeBytes } = await hashFile(part);
  if (payload.destination === 'download') {
    publishOnBag(env, part, fileName);
    return { sizeBytes, sha256, usbPath: null };
  }
  const target = join(stickRoot(env), stickFolder, fileName);
  let copied = 0;
  await copyToStick(part, target, (bytes) => {
    copied += bytes;
    env.progress(60 + Math.round((copied / Math.max(1, sizeBytes)) * 35));
  });
  writeStickFile(`${target}.sha256`, `${sha256}  ${fileName}\n`);
  return { sizeBytes, sha256, usbPath: join('SENSEBOD-OFFLINE', stickFolder, fileName) };
}

/* ------------------------------------------------------------------ */
/* learner data (DATA-EXPORT §3.1)                                     */
/* ------------------------------------------------------------------ */

/** `L-7F3KQ2`: the first 6 characters of the random part of the id; 8 for everyone if two would be the same. */
export function learnerCodes(ids: string[]): Map<string, string> {
  for (const length of [6, 8, 12, 26]) {
    const codes = new Map(ids.map((id) => [id, `L-${id.slice(3, 3 + length).toUpperCase()}`]));
    if (new Set(codes.values()).size === ids.length) return codes;
  }
  return new Map(ids.map((id) => [id, `L-${id.slice(3).toUpperCase()}`]));
}

export interface LearnerDataFiles {
  members: { name: string; data: Buffer }[];
  rowCounts: Record<string, number>;
}

/** Build every member of the learner-data zip from the two snapshots. Exported for tests. */
export function buildLearnerData(main: Db, counts: Db, options: ExportPayload['options'], info: { bagId: string; bagName: string; epoch: number; seq: number; clockTrust: string; today: string }): LearnerDataFiles {
  const from = options.from ?? '0000-00-00';
  const to = options.to ?? '9999-99-99';
  interface P {
    learner_id: string;
    portal: string;
    grp: string;
    series: string;
    position: number | null;
    title: string;
    type: string;
    state: string;
    correct: number | null;
    total: number | null;
    day: string;
    portal_id: string;
  }
  // Portals with sensitive = 1 are excluded always, whatever the mode (ADR-009).
  const progress = main.all<P>(
    `SELECT lp.learner_id, p.title AS portal, g.title AS grp, s.title AS series, l.position, l.title, l.type, lp.state, lp.correct, lp.total,
            substr(lp.updated_at, 1, 10) AS day, p.id AS portal_id
       FROM lesson_progress lp
       JOIN lesson l ON l.id = lp.lesson_id JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id
      WHERE p.sensitive = 0 AND substr(lp.updated_at, 1, 10) BETWEEN ? AND ?
      ORDER BY lp.learner_id, p.sort_order, g.sort_order, s.sort_order, l.position IS NULL, l.position`,
    from,
    to,
  );
  const withProgress = new Set(progress.map((row) => row.learner_id));
  const everyone = main.all<{ id: string; name: string; role: string; created_at: string; last_active_day: string | null }>('SELECT id, name, role, created_at, last_active_day FROM learner ORDER BY id');
  const learners = options.from || options.to ? everyone.filter((l) => withProgress.has(l.id) || ((l.last_active_day ?? '') >= from && (l.last_active_day ?? '') <= to)) : everyone;
  const codes = learnerCodes(everyone.map((l) => l.id));
  const code = (id: string): string => codes.get(id) ?? 'L-?';

  const learnersCsv = csvFile(
    ['learner_code', ...(options.includeNames ? ['name'] : []), 'role', 'first_seen_date', 'last_active_date'],
    learners.map((l) => [code(l.id), ...(options.includeNames ? [l.name] : []), l.role, l.created_at.slice(0, 10), l.last_active_day]),
  );
  const progressCsv = csvFile(
    ['learner_code', 'portal', 'group', 'series', 'lesson_number', 'lesson_title', 'lesson_type', 'state', 'correct', 'total', 'last_update_date'],
    progress.map((r) => [code(r.learner_id), r.portal, r.grp, r.series, r.position === null ? 'quiz' : r.position, r.title, r.type, r.state, r.correct, r.total, r.day]),
  );
  const portals = main.all<{ id: string; title: string }>('SELECT id, title FROM portal WHERE sensitive = 0 ORDER BY sort_order');
  const summaryCsv = csvFile(
    ['portal', 'learners_with_progress', 'lessons_started', 'lessons_finished', 'quizzes_finished', 'average_quiz_score_percent'],
    portals.map((portal) => {
      const rows = progress.filter((r) => r.portal_id === portal.id);
      const quizzes = rows.filter((r) => r.type === 'check' && r.state === 'finished');
      const scored = quizzes.filter((r) => r.correct !== null && r.total !== null && r.total > 0);
      const average = scored.length > 0 ? Math.round((scored.reduce((sum, r) => sum + (r.correct as number) / (r.total as number), 0) / scored.length) * 100) : null;
      return [portal.title, new Set(rows.map((r) => r.learner_id)).size, rows.filter((r) => r.state === 'started').length, rows.filter((r) => r.state === 'finished').length, quizzes.length, average];
    }),
  );
  const members: { name: string; data: Buffer }[] = [
    { name: 'learners.csv', data: learnersCsv },
    { name: 'progress.csv', data: progressCsv },
    { name: 'summary_by_portal.csv', data: summaryCsv },
  ];
  const rowCounts: Record<string, number> = { learners: learners.length, progress: progress.length };

  let countsPeriod = 'not included';
  if (options.includeChildProtectionCounts) {
    // Whole calendar months only, and never the current, unfinished month: two exports a day apart cannot
    // be subtracted to reveal a single view (V-014).
    const thisMonth = info.today.slice(0, 7);
    const firstMonth = options.from ? options.from.slice(0, 7) : '0000-00';
    const lastMonth = options.to ? options.to.slice(0, 7) : '9999-99';
    const monthly = counts.all<{ lesson_id: string; month: string; opened: number; finished: number }>(
      `SELECT lesson_id, substr(day, 1, 7) AS month, sum(opened) AS opened, sum(finished) AS finished FROM sensitive_activity_count
        WHERE substr(day, 1, 7) < ? AND substr(day, 1, 7) BETWEEN ? AND ? GROUP BY lesson_id, substr(day, 1, 7) ORDER BY month, lesson_id`,
      thisMonth,
      firstMonth,
      lastMonth,
    );
    const lessonInfo = new Map(
      main
        .all<{ id: string; title: string; position: number | null; series: string; audience: string }>(
          'SELECT l.id, l.title, l.position, s.title AS series, g.title AS audience FROM lesson l JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id',
        )
        .map((l) => [l.id, l]),
    );
    const small = (n: number): string | number => (n < 5 ? '<5' : n);
    const rows = monthly
      .filter((m) => lessonInfo.has(m.lesson_id))
      .map((m) => {
        const l = lessonInfo.get(m.lesson_id) as { title: string; position: number | null; series: string; audience: string };
        return [m.month, l.audience, l.series, l.position === null ? 'quiz' : l.position, l.title, small(m.opened), small(m.finished)];
      });
    members.push({ name: 'child_protection_counts.csv', data: csvFile(['month', 'audience', 'series', 'lesson_number', 'lesson_title', 'times_opened', 'times_finished'], rows) });
    rowCounts.childProtectionCounts = rows.length;
    countsPeriod = `whole months before ${thisMonth}`;
  }

  const readme = [
    'Sensebod Offline learner data',
    '=====================',
    '',
    `Bag: ${info.bagName}`,
    `Made on: ${info.today}${info.clockTrust === 'unsure' ? " (the bag's clock may be wrong)" : ''}`,
    `Period: ${options.from ?? 'the beginning'} to ${options.to ?? 'now'}`,
    `Names: ${options.includeNames ? 'INCLUDED. This file has children’s names. Send it only to the person who asked for it, then delete it.' : 'not included. Each person appears as a code such as L-7F3KQ2.'}`,
    '',
    'Files',
    `  learners.csv              one row per person (${learners.length} rows)`,
    `  progress.csv              one row per lesson a person started or finished (${progress.length} rows)`,
    '  summary_by_portal.csv     totals for each portal',
    ...(options.includeChildProtectionCounts ? ['  child_protection_counts.csv  how often Child protection lessons were opened and finished'] : []),
    '  manifest.json             a list of the files with their check codes',
    '',
    'Child protection',
    '  The bag never records which person opened a Child protection lesson.',
    `  It keeps counts only (${countsPeriod}). These counts are page views on the bag and are`,
    '  indicative only: anyone on the bag’s Wi-Fi can add views. Numbers below 5 are shown as "<5".',
    '',
    'How to open',
    '  Open the .csv files in a spreadsheet (Excel, LibreOffice, Google Sheets).',
    '  The .zip is protected with a password. Windows and macOS cannot open it by themselves:',
    '  use 7-Zip (Windows), Keka (Mac) or ZArchiver (Android).',
    '',
    'Questions: EasySTEM.',
    '',
  ].join('\r\n');
  members.unshift({ name: 'README.txt', data: Buffer.from(readme, 'utf8') });
  const manifest = {
    format: 'sensebod-offline-learner-data/1',
    bagId: info.bagId,
    bagName: info.bagName,
    appVersion: VERSION,
    schemaHead: appliedMigrations(main).map((m) => m.id).pop() ?? null,
    epoch: info.epoch,
    changeSeq: info.seq,
    createdAt: nowIso(),
    clockTrust: info.clockTrust,
    options,
    rowCounts,
    files: members.map((m) => ({ name: m.name, sizeBytes: m.data.length, sha256: sha256Hex(m.data) })),
  };
  members.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
  return { members, rowCounts };
}

function clockTrustOf(env: JobEnv): string {
  if (env.config.dev.assumeClock) return env.config.dev.assumeClock;
  try {
    return String((JSON.parse(readFileSync(env.paths.clockJson, 'utf8')) as { trust?: string }).trust ?? 'unsure');
  } catch {
    return 'unsure';
  }
}

async function runLearnerData(env: JobEnv, payload: ExportPayload): Promise<ExportResult> {
  // Never unencrypted by accident: no password file, no zip (DATA-EXPORT §6.1).
  let password: string;
  try {
    password = readFileSync(join(env.paths.exportSecrets, payload.exportId), 'utf8');
  } catch {
    throw new JobFailure('password_missing', 'The password of this download was lost. Make it again.');
  }
  if (password.length < 12) throw new JobFailure('password_missing', 'The password of this download was lost. Make it again.');
  const snap = takeSnapshots(env, payload.exportId);
  env.progress(20);
  const main = new Db(snap.main, { role: 'batch', readOnly: true, skipWalAssert: true });
  const counts = new Db(snap.counts, { role: 'batch', readOnly: true, skipWalAssert: true });
  let files: LearnerDataFiles;
  try {
    files = buildLearnerData(main, counts, payload.options, { bagId: snap.bagId, bagName: snap.bagName, epoch: snap.epoch, seq: snap.seq, clockTrust: clockTrustOf(env), today: new Date().toISOString().slice(0, 10) });
  } finally {
    main.close();
    counts.close();
  }
  env.progress(40);
  const fileName = `sensebod-offline-learner-data_${slug(snap.bagName)}_${stamp(new Date())}_${payload.exportId.slice(3, 9)}.zip`;
  const part = join(snap.dir, `${fileName}.part`);
  const zip = new ZipWriter(part, password);
  try {
    for (const member of files.members) zip.add(member.name, member.data);
    zip.finish();
  } catch (error) {
    zip.abort();
    throw error;
  }
  env.progress(60);
  const delivered = await deliver(env, payload, part, fileName, 'learner-data');
  return { fileName, ...delivered, rowCounts: files.rowCounts, snapshotSeq: snap.seq, detail: {} };
}

/* ------------------------------------------------------------------ */
/* records backup (DATA-EXPORT §3.2): tar → age, readable only by EasySTEM */
/* ------------------------------------------------------------------ */

interface BackupFile {
  fileName: string;
  part: string;
  manifest: Record<string, unknown>;
  blobs: { sha256: string; size: number; ext: string; rel: string }[];
  packages: string[];
  rowCounts: Record<string, number>;
  snap: Snapshots;
}

/** tar the manifest and both snapshots into `age -R recipients`. No secret is involved on the bag: it cannot read what it makes. */
async function buildBackup(env: JobEnv, exportId: string, scope: 'records' | 'full', onProgress: (fraction: number) => void): Promise<BackupFile> {
  const snap = takeSnapshots(env, exportId);
  const main = new Db(snap.main, { role: 'batch', readOnly: true, skipWalAssert: true });
  const counts = new Db(snap.counts, { role: 'batch', readOnly: true, skipWalAssert: true });
  let blobs: BackupFile['blobs'];
  let packages: string[];
  let rowCounts: Record<string, number>;
  let heads: { main: string | null; counts: string | null };
  try {
    blobs = main.all<{ sha256: string; size_bytes: number; ext: string; rel_path: string }>('SELECT sha256, size_bytes, ext, rel_path FROM blob ORDER BY sha256').map((b) => ({ sha256: b.sha256, size: b.size_bytes, ext: b.ext, rel: b.rel_path }));
    packages = main.all<{ dir_name: string }>('SELECT dir_name FROM tryit_package ORDER BY dir_name').map((p) => p.dir_name);
    const n = (sql: string): number => Number(main.value(sql) ?? 0);
    rowCounts = { learners: n('SELECT count(*) FROM learner'), progress: n('SELECT count(*) FROM lesson_progress'), lessons: n('SELECT count(*) FROM lesson'), auditEvents: n('SELECT count(*) FROM audit_event') };
    heads = { main: appliedMigrations(main).map((m) => m.id).pop() ?? null, counts: appliedMigrations(counts).map((m) => m.id).pop() ?? null };
  } finally {
    main.close();
    counts.close();
  }
  const [mainHash, countsHash] = await Promise.all([hashFile(snap.main), hashFile(snap.counts)]);
  const manifest = {
    format: 'sensebod-offline-backup/1',
    scope,
    backupId: exportId,
    bagId: snap.bagId,
    bagName: snap.bagName,
    appVersion: VERSION,
    runtime: process.version,
    schemaHead: heads,
    createdAt: nowIso(),
    clockTrust: clockTrustOf(env),
    epoch: snap.epoch,
    epochNonce: snap.epochNonce,
    changeSeq: snap.seq,
    databases: {
      'db/sensebod-offline.sqlite3': { sizeBytes: mainHash.sizeBytes, sha256: mainHash.sha256 },
      'db/counts.sqlite3': { sizeBytes: countsHash.sizeBytes, sha256: countsHash.sha256 },
    },
    media: blobs.map(({ sha256, size, ext }) => ({ sha256, size, ext })),
    tryitPackages: packages,
    childProtectionMode: env.config.childProtection.progressMode,
    rowCounts,
  };
  const fileName = `sensebod-offline-backup_${slug(snap.bagName)}_${stamp(new Date())}_${exportId.slice(3, 9)}.sbk`;
  const part = join(snap.dir, `${fileName}.part`);
  const members: TarMember[] = [
    { name: 'BACKUP-MANIFEST.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'db/sensebod-offline.sqlite3', file: snap.main },
    { name: 'db/counts.sqlite3', file: snap.counts },
  ];
  const total = mainHash.sizeBytes + countsHash.sizeBytes + 4096;
  let written = 0;
  await new Promise<void>((resolve, reject) => {
    // Arguments are the public recipients file and the output path only.
    const age = spawn(env.config.tools.age, ['-R', env.config.paths.recipientsFile, '-o', part], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    age.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-500);
    });
    age.on('error', (error) => reject((error as { code?: string }).code === 'ENOENT' ? new JobFailure('internal', 'age is not installed on this bag.') : error));
    age.on('close', (code) => (code === 0 ? resolve() : reject(new JobFailure('internal', `age failed (${code}).`))));
    age.stdin.on('error', () => undefined);
    writeTar(age.stdin, members, (bytes) => {
      written += bytes;
      onProgress(Math.min(1, written / total));
    }).then(
      () => age.stdin.end(),
      (error: unknown) => {
        age.kill();
        reject(error);
      },
    );
  });
  return { fileName, part, manifest, blobs, packages, rowCounts, snap };
}

async function runBackupRecords(env: JobEnv, payload: ExportPayload): Promise<ExportResult> {
  const backup = await buildBackup(env, payload.exportId, 'records', (fraction) => env.progress(20 + Math.round(fraction * 40)));
  if (payload.destination === 'download') {
    const delivered = await deliver(env, payload, backup.part, backup.fileName, '');
    return { fileName: backup.fileName, ...delivered, rowCounts: backup.rowCounts, snapshotSeq: backup.snap.seq, detail: {} };
  }
  const written = await writeBackupToStick(env, backup, 'records');
  return { fileName: backup.fileName, ...written, rowCounts: backup.rowCounts, snapshotSeq: backup.snap.seq };
}

/* ------------------------------------------------------------------ */
/* the stick: records folder, LATEST.json, retention (DATA-EXPORT §10)  */
/* ------------------------------------------------------------------ */

const KEEP_BACKUPS = 3;
const LEARNER_DATA_DAYS_ON_STICK = 7;

function stickLabel(env: JobEnv): string | null {
  try {
    const stick = JSON.parse(readFileSync(join(stickRoot(env), 'STICK.json'), 'utf8')) as { label?: string };
    return stick.label === 'SENSEBOD-A' ? 'A' : stick.label === 'SENSEBOD-B' ? 'B' : null;
  } catch {
    return null;
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Remove what the rules say may go, only inside SENSEBOD-OFFLINE/. Returns counts for the audit. */
export function stickRetention(root: string, bagId: string, now = Date.now()): { backupsRemoved: number; mediaRemoved: number; learnerDataRemoved: number; partialsRemoved: number } {
  const out = { backupsRemoved: 0, mediaRemoved: 0, learnerDataRemoved: 0, partialsRemoved: 0 };
  const bagDir = join(root, bagId);
  const records = join(bagDir, 'records');
  let latest = '';
  try {
    latest = String((JSON.parse(readFileSync(join(bagDir, 'LATEST.json'), 'utf8')) as { file?: string }).file ?? '');
  } catch {
    latest = '';
  }
  // The file name carries the creation time (…_YYYYMMDD-HHMM_…), so sorting by name is sorting by age.
  const backups = list(records).filter((name) => name.endsWith('.sbk')).sort().reverse();
  const keep = new Set(backups.slice(0, KEEP_BACKUPS));
  if (latest) keep.add(latest);
  for (const name of backups) {
    if (keep.has(name)) continue;
    for (const suffix of ['', '.sha256', '.media.json']) rmSync(join(records, name + suffix), { force: true });
    out.backupsRemoved += 1;
  }
  // Media copies are kept while any kept backup lists them (its plain .media.json beside it).
  const wanted = new Set<string>();
  let listsComplete = true;
  for (const name of keep) {
    try {
      for (const entry of JSON.parse(readFileSync(join(records, `${name}.media.json`), 'utf8')) as string[]) wanted.add(entry);
    } catch {
      listsComplete = false;
    }
  }
  if (listsComplete && keep.size > 0) {
    for (const shard of list(join(bagDir, 'media'))) {
      for (const name of list(join(bagDir, 'media', shard))) {
        if (name.endsWith('.partial')) continue;
        if (!wanted.has(name)) {
          rmSync(join(bagDir, 'media', shard, name), { force: true });
          out.mediaRemoved += 1;
        }
      }
    }
  }
  // Learner-data zips hold children's data: 7 days on a stick, then removed at the next visit to a bag.
  for (const name of list(join(root, 'learner-data'))) {
    const match = /_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})_/.exec(name);
    if (!match) continue;
    const made = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`);
    if (Number.isFinite(made) && now - made > LEARNER_DATA_DAYS_ON_STICK * 24 * HOUR && now > made) {
      rmSync(join(root, 'learner-data', name), { force: true });
      if (name.endsWith('.zip')) out.learnerDataRemoved += 1;
    }
  }
  const sweep = (dir: string, depth: number): void => {
    for (const name of list(dir)) {
      const full = join(dir, name);
      if (name.endsWith('.partial')) {
        rmSync(full, { force: true });
        out.partialsRemoved += 1;
      } else if (depth < 4) {
        try {
          if (statSync(full).isDirectory()) sweep(full, depth + 1);
        } catch {
          // vanished
        }
      }
    }
  };
  sweep(root, 0);
  return out;
}

async function writeBackupToStick(env: JobEnv, backup: BackupFile, scope: 'records' | 'full'): Promise<{ sizeBytes: number; sha256: string; usbPath: string; detail: Record<string, unknown> }> {
  const root = stickRoot(env);
  const bagDir = join(root, backup.snap.bagId);
  const records = join(bagDir, 'records');
  fsyncPath(backup.part);
  const { sha256, sizeBytes } = await hashFile(backup.part);
  const target = join(records, backup.fileName);
  await copyToStick(backup.part, target);
  writeStickFile(`${target}.sha256`, `${sha256}  ${backup.fileName}\n`);
  // The list of media this backup needs, in the clear (they are hashes of lesson files): stick retention reads it.
  writeStickFile(`${target}.media.json`, JSON.stringify(backup.blobs.map((b) => `${b.sha256}.${b.ext}`)));
  if (!existsSync(join(bagDir, 'README.txt'))) {
    writeStickFile(join(bagDir, 'README.txt'), `Sensebod Offline backup of the bag "${backup.snap.bagName}".\r\nOnly EasySTEM can open the files in records/.\r\nDo not edit or rename these files.\r\n`);
  }
  // LATEST.json is written last: it names the newest COMPLETE backup.
  writeStickFile(join(bagDir, 'LATEST.json'), JSON.stringify({ file: backup.fileName, sha256, sizeBytes, scope, bagId: backup.snap.bagId, bagName: backup.snap.bagName, createdAt: nowIso(), epoch: backup.snap.epoch, changeSeq: backup.snap.seq }));
  let retention: Record<string, number> = {};
  try {
    retention = stickRetention(root, backup.snap.bagId);
  } catch (error) {
    throw fileFailure(error, true) ?? error;
  }
  return { sizeBytes, sha256, usbPath: join('SENSEBOD-OFFLINE', backup.snap.bagId, 'records', backup.fileName), detail: { stickLabel: stickLabel(env), scope, ...retention } };
}

/* ------------------------------------------------------------------ */
/* full backup to a stick (DATA-EXPORT §11)                             */
/* ------------------------------------------------------------------ */

async function runBackupFull(env: JobEnv, payload: ExportPayload): Promise<ExportResult> {
  const root = stickRoot(env);
  const backup = await buildBackup(env, payload.exportId, 'full', (fraction) => env.progress(Math.round(fraction * 10)));
  const bagDir = join(root, backup.snap.bagId);
  // Only what the stick does not have yet (name = hash, size equal) is copied: later backups are incremental.
  const missing = backup.blobs.filter((blob) => {
    try {
      return statSync(join(bagDir, 'media', blob.sha256.slice(0, 2), `${blob.sha256}.${blob.ext}`)).size !== blob.size;
    } catch {
      return true;
    }
  });
  const totalBytes = missing.reduce((sum, blob) => sum + blob.size, 0);
  try {
    const free = statfsSync(root.replace(/\/SENSEBOD-OFFLINE$/, ''));
    if (Number(free.bavail) * Number(free.bsize) < totalBytes + 2 * statSync(backup.part).size) throw new JobFailure('usb_full', 'The stick is full.');
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    throw fileFailure(error, true) ?? new JobFailure('usb_removed', 'The stick was taken out too early.');
  }
  let copiedBytes = 0;
  let blobsCopied = 0;
  for (const blob of missing) {
    const source = join(env.paths.media, blob.rel);
    if (!existsSync(source)) continue; // reported by the manifest check at restore; a missing file must not stop the backup
    await copyToStick(source, join(bagDir, 'media', blob.sha256.slice(0, 2), `${blob.sha256}.${blob.ext}`), (bytes) => {
      copiedBytes += bytes;
      env.progress(10 + Math.round((copiedBytes / Math.max(1, totalBytes)) * 75));
    });
    blobsCopied += 1;
  }
  for (const dirName of backup.packages) {
    const target = join(bagDir, 'tryit', `${dirName}.tar`);
    const source = join(env.paths.tryit, dirName);
    if (existsSync(target) || !existsSync(source)) continue;
    const tmp = join(backup.snap.dir, `${dirName}.tar`);
    const members: TarMember[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const name of list(dir)) {
        const full = join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) walk(full, `${prefix}${name}/`);
        else if (s.isFile()) members.push({ name: prefix + name, file: full });
      }
    };
    walk(source, '');
    const out = createWriteStream(tmp);
    await writeTar(out, members);
    await new Promise<void>((resolve, reject) => out.end(() => resolve()).on('error', reject));
    await copyToStick(tmp, target);
    rmSync(tmp, { force: true });
  }
  env.progress(90);
  const written = await writeBackupToStick(env, backup, 'full');
  return { fileName: backup.fileName, sizeBytes: written.sizeBytes, sha256: written.sha256, usbPath: written.usbPath, rowCounts: backup.rowCounts, snapshotSeq: backup.snap.seq, detail: { ...written.detail, blobsCopied, bytesCopied: copiedBytes } };
}

/* ------------------------------------------------------------------ */
/* diagnostics (DATA-EXPORT §3.4): no personal data, and scanned        */
/* ------------------------------------------------------------------ */

/** The reasons a diagnostics member must not be published. Exported for tests. */
export function privacyHits(text: string, learnerNames: string[], sensitiveLessonIds: string[]): string[] {
  const hits: string[] = [];
  LEARNER_ID_ANYWHERE.lastIndex = 0;
  if (LEARNER_ID_ANYWHERE.test(text)) hits.push('learner id');
  LEARNER_ID_ANYWHERE.lastIndex = 0;
  if (/\b10\.(10|20)\.0\.\d{1,3}\b/.test(text)) hits.push('wifi address');
  const lower = text.toLowerCase();
  // Names are matched as whole words, so "Sam" does not fire on "sample".
  for (const name of learnerNames) {
    if (name.length < 3) continue;
    const at = lower.indexOf(name.toLowerCase());
    if (at === -1) continue;
    const before = at === 0 ? ' ' : (lower[at - 1] as string);
    const after = at + name.length >= lower.length ? ' ' : (lower[at + name.length] as string);
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
      hits.push('learner name');
      break;
    }
  }
  if (sensitiveLessonIds.some((id) => text.indexOf(id) !== -1)) hits.push('child protection lesson id');
  return hits;
}

async function runDiagnostics(env: JobEnv, payload: ExportPayload): Promise<ExportResult> {
  const snap = takeSnapshots(env, payload.exportId);
  const main = new Db(snap.main, { role: 'batch', readOnly: true, skipWalAssert: true });
  const members: { name: string; data: Buffer }[] = [];
  let names: string[];
  let sensitive: string[];
  try {
    const rows = (sql: string): Record<string, unknown>[] => main.all<Record<string, unknown>>(sql);
    const table = (name: string, header: string[], sql: string): void => {
      members.push({ name, data: csvFile(header, rows(sql).map((row) => header.map((key) => (row[key] ?? null) as string | number | null))) });
    };
    const meta = Object.fromEntries(rows("SELECT key, value FROM bag_meta WHERE key IN ('bag_name','epoch','change_seq','boot_seq','uptime_total_s','content_rev','restored_from','provisioned_at')").map((r) => [String(r.key), r.value]));
    members.push({
      name: 'status.json',
      data: Buffer.from(
        JSON.stringify(
          {
            format: 'sensebod-offline-diagnostics/1',
            version: VERSION,
            runtime: process.version,
            arch: process.arch,
            createdAt: nowIso(),
            clockTrust: clockTrustOf(env),
            bag: meta,
            schema: appliedMigrations(main).map((m) => m.id),
            counts: {
              lessons: Number(main.value('SELECT count(*) FROM lesson') ?? 0),
              published: Number(main.value("SELECT count(*) FROM lesson WHERE status = 'published'") ?? 0),
              learners: Number(main.value('SELECT count(*) FROM learner') ?? 0),
              progress: Number(main.value('SELECT count(*) FROM lesson_progress') ?? 0),
              blobs: Number(main.value('SELECT count(*) FROM blob') ?? 0),
              blobBytes: Number(main.value('SELECT coalesce(sum(size_bytes), 0) FROM blob') ?? 0),
              admins: Number(main.value('SELECT count(*) FROM admin_account WHERE is_active = 1') ?? 0),
            },
            databaseBytes: statSync(snap.main).size,
            childProtectionMode: env.config.childProtection.progressMode,
          },
          null,
          2,
        ),
        'utf8',
      ),
    });
    table('health.csv', ['at', 'cpu_temp_c', 'throttled_bits', 'load1', 'mem_available_mb', 'disk_free_bytes', 'db_bytes', 'wal_bytes'], 'SELECT * FROM health_sample ORDER BY at');
    table('boots.csv', ['started_at', 'previous_clean', 'clock_trust', 'recovery_note'], 'SELECT started_at, previous_clean, clock_trust, recovery_note FROM boot ORDER BY started_at');
    // Ids, kinds, states, codes, sizes and timings only: no payloads, no options, no names.
    table('jobs.csv', ['id', 'kind', 'lane', 'state', 'attempts', 'progress', 'created_at', 'started_at', 'finished_at', 'error_code'], 'SELECT id, kind, lane, state, attempts, progress, created_at, started_at, finished_at, error_code FROM job ORDER BY created_at');
    table('exports.csv', ['id', 'kind', 'destination', 'state', 'created_at', 'ready_at', 'size_bytes', 'error_code', 'download_count'], 'SELECT id, kind, destination, state, created_at, ready_at, size_bytes, error_code, download_count FROM export ORDER BY created_at');
    // Application events: actions and outcomes of the audit trail, without actors, targets, details or addresses.
    const events = rows('SELECT at, action, outcome FROM audit_event ORDER BY id DESC LIMIT 2000').map((r) => `${String(r.at)} ${String(r.action)} ${String(r.outcome)}`);
    members.push({ name: 'events.txt', data: Buffer.from(events.reverse().join('\n') + '\n', 'utf8') });
    names = rows('SELECT name FROM learner').map((r) => String(r.name));
    sensitive = rows('SELECT l.id FROM lesson l JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id WHERE p.sensitive = 1').map((r) => String(r.id));
  } finally {
    main.close();
  }
  env.progress(40);
  // Publication rule: any hit fails the export instead of publishing it.
  for (const member of members) {
    const hits = privacyHits(member.data.toString('utf8'), names, sensitive);
    if (hits.length > 0) throw new JobFailure('privacy_scan', `The report was not made: ${member.name} held a ${hits[0]}.`);
  }
  const fileName = `sensebod-offline-diagnostics_${slug(snap.bagName)}_${stamp(new Date())}_${payload.exportId.slice(3, 9)}.zip`;
  const part = join(snap.dir, `${fileName}.part`);
  const zip = new ZipWriter(part, null);
  try {
    for (const member of members) zip.add(member.name, member.data);
    zip.finish();
  } catch (error) {
    zip.abort();
    throw error;
  }
  env.progress(60);
  const delivered = await deliver(env, payload, part, fileName, 'diagnostics');
  return { fileName, ...delivered, rowCounts: { files: members.length }, snapshotSeq: snap.seq, detail: {} };
}

export const exportLearnerData = (lane: 'data' | 'usb'): Handler => exportHandler(lane, runLearnerData);
export const backupRecords = (lane: 'data' | 'usb'): Handler => exportHandler(lane, runBackupRecords);
export const diagnostics = (lane: 'data' | 'usb'): Handler => exportHandler(lane, runDiagnostics);
export const backupFullUsb: Handler = exportHandler('usb', runBackupFull);

/* ------------------------------------------------------------------ */
/* check the stick, format the stick                                    */
/* ------------------------------------------------------------------ */

export const usbCheck: Handler = {
  lane: 'usb',
  async run(env) {
    const root = stickRoot(env);
    let checked = 0;
    let bad = 0;
    const files: { file: string; expected: string }[] = [];
    const walk = (dir: string, depth: number): void => {
      for (const name of list(dir)) {
        const full = join(dir, name);
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          if (depth < 5) walk(full, depth + 1);
          continue;
        }
        // Media copies are named by their hash; other files have a .sha256 beside them.
        const hashed = /^([0-9a-f]{64})\.[a-z0-9]{2,5}$/.exec(name);
        if (hashed) files.push({ file: full, expected: hashed[1] as string });
        else if (existsSync(`${full}.sha256`)) files.push({ file: full, expected: readFileSync(`${full}.sha256`, 'utf8').slice(0, 64) });
      }
    };
    try {
      walk(root, 0);
      for (const item of files) {
        const { sha256 } = await hashFile(item.file);
        checked += 1;
        if (sha256 !== item.expected) bad += 1;
        env.progress(Math.round((checked / Math.max(1, files.length)) * 100));
      }
    } catch (error) {
      throw fileFailure(error, true) ?? error;
    }
    return { checked, bad };
  },
  finalize(_ctx, tx, _job, raw) {
    const result = raw as { checked: number; bad: number };
    tx.audit({ actorId: 'system', actorName: 'system', action: 'usb.check', outcome: result.bad === 0 ? 'ok' : 'failed', detail: result });
    return undefined;
  },
  failed(_ctx, tx, _job, state, code) {
    tx.audit({ actorId: 'system', actorName: 'system', action: 'usb.check', outcome: state, detail: { errorCode: code } });
    return undefined;
  },
};

export const usbFormat: Handler = {
  lane: 'usb',
  async run(env) {
    const label = env.job.payload.label;
    const kernelName = String(env.job.payload.kernelName ?? '');
    if ((label !== 'A' && label !== 'B') || !/^sd[a-z][0-9]*$/.test(kernelName)) throw new JobFailure('internal', 'The format request is not valid.');
    // The root unit does its own target checks (never the bag's own card): SYSTEM-ARCHITECTURE §9.8.
    const requestNonce = nonce();
    const request = writeRequest(env, requestNonce, { label, confirm: 'FORMAT', kernelName });
    try {
      await startUnit(env, `sensebod-offline-usb-format@${kernelName}-${requestNonce}.service`, { wait: true, timeoutMs: 4 * 60_000 });
    } catch {
      throw new JobFailure('internal', 'The stick could not be formatted.');
    } finally {
      dropRequest(request);
    }
    return { label };
  },
  finalize(_ctx, tx, _job, raw) {
    tx.audit({ actorId: 'system', actorName: 'system', action: 'usb.format', detail: { label: (raw as { label: string }).label, stage: 'done' } });
    return undefined;
  },
  failed(_ctx, tx, _job, state, code) {
    tx.audit({ actorId: 'system', actorName: 'system', action: 'usb.format', outcome: state, detail: { errorCode: code } });
    return undefined;
  },
};

/** Used by maintenance: re-hash a ready export after an unclean boot (DATA-EXPORT §13 step 7). */
export async function exportFileMatches(file: string, sizeBytes: number, sha256: string): Promise<boolean> {
  try {
    if (statSync(file).size !== sizeBytes) return false;
    return (await hashFile(file)).sha256 === sha256;
  } catch {
    return false;
  }
}


