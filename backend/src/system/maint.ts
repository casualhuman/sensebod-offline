/*
 * sensebod-offline-maint: everything that happens on a timer (every 15 minutes, and
 * one minute after boot). It is its own process, not a worker lane, so no
 * export, conversion or stick can delay a snapshot or retention (V-003).
 *
 * Lock-hold discipline (R-3H): every transaction is small; deletes go in
 * batches of at most 500 rows with a pause of at least 100 ms between them;
 * the TRUNCATE checkpoint is tried only when no job runs, on a connection
 * that gives up after 100 ms.
 *
 * Each task is independent: one that fails is logged and the others still run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { bootUptimeS, type Ctx } from '../core/context.ts';
import { Db, checkDatabase } from '../core/db.ts';
import { diskSpace, removeQuietly } from '../core/fsx.ts';
import { log, logError } from '../core/log.ts';
import { DAY, HOUR, MINUTE, dayOf, nowIso } from '../core/time.ts';
import { exportFileMatches } from '../exports/jobs.ts';
import { listSnapshots, rotateSnapshots, snapshotIsSound, takeSnapshotPair } from '../exports/snapshots.ts';
import { clockAllowsRetention, deleteLearners, planRetention } from '../learners/retention.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const BATCH = 500;
const PAUSE_MS = 100;
const GIB = 1024 ** 3;

function getSetting<T>(ctx: Ctx, key: string): T | null {
  const raw = ctx.db.value<string>('SELECT value_json FROM setting WHERE key = ?', key);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function setSetting(ctx: Ctx, key: string, value: unknown): void {
  ctx.writeSync((tx) =>
    tx.run(
      "INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, 'system') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      key,
      JSON.stringify(value),
      nowIso(),
    ),
  );
}

/** Delete rows in batches of 500 by rowid, pausing between batches so other writers get their turn. */
async function deleteInBatches(ctx: Ctx, table: string, where: string, params: (string | number)[]): Promise<number> {
  let total = 0;
  for (;;) {
    const removed = ctx.writeSync((tx) => tx.run(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${BATCH})`, ...params));
    total += removed;
    if (removed < BATCH) return total;
    await sleep(PAUSE_MS);
  }
}

/* ---- one-time password files that nothing needs any more (V-021) ---- */
export function sweepSecrets(ctx: Ctx): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(ctx.paths.exportSecrets);
  } catch {
    return 0;
  }
  for (const name of names) {
    const file = join(ctx.paths.exportSecrets, name);
    const row = ctx.db.get<{ state: string }>('SELECT state FROM export WHERE id = ?', name.replace(/\.tmp-\d+$/, ''));
    let ageMs = 0;
    try {
      ageMs = Date.now() - statSync(file).mtimeMs;
    } catch {
      continue;
    }
    // Kept only while its export is being prepared; a file without a row gets 10 minutes (the API may be about to commit).
    if ((row && row.state !== 'preparing') || (!row && Math.abs(ageMs) > 10 * MINUTE)) {
      rmSync(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/* ---- exports: re-check after an unclean boot, expiry, old rows ---- */
export async function recheckExports(ctx: Ctx): Promise<void> {
  const rows = ctx.db.all<{ id: string; file_name: string | null; size_bytes: number | null; sha256: string | null }>("SELECT id, file_name, size_bytes, sha256 FROM export WHERE state = 'checking'");
  for (const row of rows) {
    const file = row.file_name ? join(ctx.paths.exports, row.file_name) : null;
    const ok = file !== null && row.size_bytes !== null && row.sha256 !== null && (await exportFileMatches(file, row.size_bytes, row.sha256));
    ctx.writeSync((tx) => {
      if (ok) tx.run("UPDATE export SET state = 'ready' WHERE id = ? AND state = 'checking'", row.id);
      else {
        tx.run("UPDATE export SET state = 'interrupted', error_code = 'file_lost' WHERE id = ? AND state = 'checking'", row.id);
        tx.audit({ actorId: 'system', actorName: 'system', action: 'export.interrupted', targetType: 'export', targetId: row.id, outcome: 'interrupted', detail: { errorCode: 'file_lost' } });
      }
    });
    if (!ok && file) removeQuietly(file);
  }
}

const UPTIME_LIMIT_S: Record<string, number> = { 'learner-data': 24 * 3600, 'backup-records': 7 * 86400, diagnostics: 7 * 86400 };

/** A file goes at the FIRST of: its wall-clock time, its uptime within the boot it was made in (boots are counted at boot). */
export function expireExports(ctx: Ctx): number {
  const now = nowIso();
  const trusted = ctx.clockTrust() !== 'unsure';
  const rows = ctx.db.all<{ id: string; kind: string; file_name: string | null; expires_at: string | null; ready_boot_id: string | null; ready_uptime_s: number | null }>(
    "SELECT id, kind, file_name, expires_at, ready_boot_id, ready_uptime_s FROM export WHERE state = 'ready' AND destination = 'download'",
  );
  let expired = 0;
  for (const row of rows) {
    const byClock = trusted && row.expires_at !== null && row.expires_at <= now;
    const limit = UPTIME_LIMIT_S[row.kind];
    const byUptime = limit !== undefined && row.ready_boot_id === ctx.boot.bootId && row.ready_uptime_s !== null && bootUptimeS() - row.ready_uptime_s >= limit;
    if (!byClock && !byUptime) continue;
    ctx.writeSync((tx) => {
      tx.run("UPDATE export SET state = 'expired' WHERE id = ? AND state = 'ready'", row.id);
      tx.audit({ actorId: 'system', actorName: 'system', action: 'export.expire', targetType: 'export', targetId: row.id, detail: { reason: byUptime ? 'uptime' : 'clock' } });
    });
    if (row.file_name) removeQuietly(join(ctx.paths.exports, row.file_name));
    expired += 1;
  }
  return expired;
}

/* ---- learner data: two months, guarded (DATA-EXPORT §8.1) ---- */
export async function runRetention(ctx: Ctx, today = dayOf()): Promise<{ removed: number; heldBack: number; postponed: boolean }> {
  if (!clockAllowsRetention(ctx.clockTrust())) return { removed: 0, heldBack: 0, postponed: true };
  // Once a day. A clock that went backwards must not run it twice for the same day either.
  const last = getSetting<string>(ctx, 'retention.last_run_day');
  if (last !== null && last >= today) return { removed: 0, heldBack: 0, postponed: false };
  const plan = planRetention(ctx.db, ctx.config.retention, today);
  // At most 10 % of the learners on the bag per run (at least one, so small bags still age).
  const cap = Math.max(1, Math.floor(plan.total * ctx.config.retention.maxShareWithoutConfirm));
  const chosen = plan.removable.slice(0, cap);
  let removed = 0;
  let progress = 0;
  for (let at = 0; at < chosen.length; at += BATCH) {
    const result = ctx.writeSync((tx) => deleteLearners(tx, chosen.slice(at, at + BATCH)), { secureDelete: true });
    removed += result.learners;
    progress += result.progress;
    await sleep(PAUSE_MS);
  }
  ctx.writeSync((tx) => {
    tx.run(
      "INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES ('retention.last_run_day', ?, ?, 'system') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      JSON.stringify(today),
      nowIso(),
    );
    // Counts only, never names or ids.
    if (removed > 0 || plan.heldBack > 0) tx.audit({ actorId: 'system', actorName: 'system', action: 'learner.expire', detail: { learnersRemoved: removed, progressRemoved: progress, heldBack: plan.heldBack, waiting: plan.removable.length - removed } });
  });
  return { removed, heldBack: plan.heldBack, postponed: false };
}

/* ---- local snapshots (DATA-EXPORT §9) ---- */
export function snapshotIfDue(ctx: Ctx): boolean {
  const seq = ctx.metaInt('change_seq');
  const last = getSetting<{ uptimeS: number; seq: number; bootId: string }>(ctx, 'snapshot.last');
  const requested = getSetting<boolean>(ctx, 'snapshot.requested') === true;
  const none = listSnapshots(ctx.paths).filter((s) => s.kind === 'auto').length === 0;
  const uptime = ctx.uptimeTotalS();
  // (a) 2 h of uptime since the last one and something changed; (c) the first idle moment after an unclean boot; or asked for.
  const afterUncleanBoot = !ctx.boot.previousClean && (last === null || last.bootId !== ctx.boot.bootId);
  const due = requested || none || afterUncleanBoot || (last !== null && uptime - last.uptimeS >= 2 * 3600 && seq !== last.seq);
  if (!due) return false;
  const space = diskSpace(ctx.paths.data);
  takeSnapshotPair(ctx.paths, ctx.db, ctx.counts, 'auto');
  // Oldest go only after the new one is complete; the total stays under 10 % of free space or 2 GiB.
  rotateSnapshots(ctx.paths, Math.min(2 * GIB, space ? Math.floor(space.availableBytes / 10) : 2 * GIB));
  setSetting(ctx, 'snapshot.last', { uptimeS: uptime, seq, bootId: ctx.boot.bootId });
  if (requested) setSetting(ctx, 'snapshot.requested', false);
  return true;
}

/* ---- small tables that only grow ---- */
export async function pruneTables(ctx: Ctx): Promise<void> {
  const now = nowIso();
  const before = (ms: number): string => new Date(Date.now() - ms).toISOString();
  await deleteInBatches(ctx, 'admin_session', 'idle_expires_at <= ? OR absolute_expires_at <= ? OR boot_id <> ?', [now, now, ctx.boot.bootId]);
  await deleteInBatches(ctx, 'idempotency_record', 'created_at < ?', [before(DAY)]);
  await deleteInBatches(ctx, 'job', "state IN ('done','failed','interrupted','cancelled') AND coalesce(finished_at, created_at) < ? AND id NOT IN (SELECT job_id FROM export WHERE job_id IS NOT NULL)", [before(30 * DAY)]);
  await deleteInBatches(ctx, 'health_sample', 'at < ?', [before(30 * DAY)]);
  await deleteInBatches(ctx, 'override_presence', 'created_uptime_s < ? OR created_uptime_s > ?', [ctx.uptimeTotalS() - 150, ctx.uptimeTotalS()]);
  await deleteInBatches(ctx, 'tombstone', 'deleted_at < ?', [before(365 * DAY)]);
  // Exports: rows stay 90 days after the file is gone, so the history shows what happened.
  await deleteInBatches(ctx, 'export', "state IN ('expired','deleted','failed','interrupted') AND created_at < ?", [before(90 * DAY)]);
  // Override requests: 30 days after they ended. Notices that point at them are kept until acknowledged.
  await deleteInBatches(
    ctx,
    'override_request',
    "state IN ('used','expired','void') AND created_wall_at < ? AND id NOT IN (SELECT request_id FROM override_notice)",
    [before(30 * DAY)],
  );
  // Audit: 2 years or 50,000 rows, whichever comes first.
  await deleteInBatches(ctx, 'audit_event', 'at < ?', [before(730 * DAY)]);
  const count = Number(ctx.db.value('SELECT count(*) FROM audit_event') ?? 0);
  if (count > 50_000) {
    const cut = Number(ctx.db.value('SELECT id FROM audit_event ORDER BY id DESC LIMIT 1 OFFSET 50000') ?? 0);
    await deleteInBatches(ctx, 'audit_event', 'id <= ?', [cut]);
  }
  // Uploads nobody continued for 24 h are given up; their bytes go.
  const stale = ctx.db.all<{ id: string }>("SELECT id FROM upload WHERE state = 'receiving' AND updated_at < ?", before(DAY));
  for (const row of stale) {
    ctx.writeSync((tx) => tx.run("UPDATE upload SET state = 'abandoned', updated_at = ? WHERE id = ? AND state = 'receiving'", nowIso(), row.id));
    removeQuietly(join(ctx.paths.uploadsPartial, `${row.id}.part`));
  }
}

/* ---- the counts file (DATABASE §6.4, §7) ---- */
export function maintainCounts(ctx: Ctx, today = dayOf()): void {
  const counts = ctx.counts;
  // De-duplication rows of earlier days are overwritten, not just unlinked.
  counts.tx(() => counts.run('DELETE FROM sensitive_activity_seen WHERE day < ?', today), { secureDelete: true });
  // Counts of lessons that no longer exist (the file has no foreign key to `lesson`).
  const known = new Set(ctx.db.all<{ id: string }>('SELECT id FROM lesson').map((r) => r.id));
  const present = counts.all<{ lesson_id: string }>('SELECT DISTINCT lesson_id FROM sensitive_activity_count');
  const gone = present.filter((r) => !known.has(r.lesson_id)).map((r) => r.lesson_id);
  for (let at = 0; at < gone.length; at += BATCH) {
    const slice = gone.slice(at, at + BATCH);
    counts.tx(() => {
      for (const id of slice) counts.run('DELETE FROM sensitive_activity_count WHERE lesson_id = ?', id);
    });
  }
  // After 2 years the days of a month are folded into one row for that month.
  const cut = new Date(Date.parse(`${today}T00:00:00Z`) - 730 * DAY).toISOString().slice(0, 7);
  const old = counts.all<{ lesson_id: string; month: string; opened: number; finished: number }>(
    "SELECT lesson_id, substr(day, 1, 7) AS month, sum(opened) AS opened, sum(finished) AS finished FROM sensitive_activity_count WHERE substr(day, 1, 7) < ? AND substr(day, 9, 2) <> '00' GROUP BY lesson_id, substr(day, 1, 7) LIMIT 500",
    cut,
  );
  for (const row of old) {
    counts.tx(() => {
      counts.run("DELETE FROM sensitive_activity_count WHERE lesson_id = ? AND substr(day, 1, 7) = ? AND substr(day, 9, 2) <> '00'", row.lesson_id, row.month);
      counts.run(
        'INSERT INTO sensitive_activity_count (lesson_id, day, opened, finished) VALUES (?, ?, ?, ?) ON CONFLICT (lesson_id, day) DO UPDATE SET opened = opened + excluded.opened, finished = finished + excluded.finished',
        row.lesson_id,
        `${row.month}-00`,
        row.opened,
        row.finished,
      );
    });
  }
  // Writing at every run also blurs the file's modification time to the timer interval (DATABASE §6.4, residual).
  counts.tx(() => counts.run("INSERT INTO counts_meta (key, value) VALUES ('maint_tick', '1') ON CONFLICT (key) DO UPDATE SET value = CASE value WHEN '1' THEN '0' ELSE '1' END"));
  truncateCheckpoint(ctx.paths.countsDb);
}

/** TRUNCATE on its own connection with busy_timeout = 100 ms: it gives up rather than stall writers (R-3H). */
function truncateCheckpoint(file: string): void {
  let db: Db | null = null;
  try {
    db = new Db(file, { role: 'checkpoint' });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // busy: the passive checkpoints carry on, the next run tries again
  } finally {
    db?.close();
  }
}

/* ---- media garbage collection (ADR-005) ---- */
export async function collectGarbage(ctx: Ctx): Promise<{ marked: number; deleted: number }> {
  const now = nowIso();
  // A file is in use when a lesson, a picture, a narration, a recent upload or a finished conversion of a recent upload points at it.
  const used = `SELECT blob_sha256 FROM lesson_asset
    UNION SELECT blob_sha256 FROM picture WHERE blob_sha256 IS NOT NULL
    UNION SELECT listen_blob FROM portal WHERE listen_blob IS NOT NULL
    UNION SELECT listen_blob FROM series WHERE listen_blob IS NOT NULL
    UNION SELECT listen_blob FROM lesson WHERE listen_blob IS NOT NULL
    UNION SELECT blob_sha256 FROM upload WHERE blob_sha256 IS NOT NULL AND state IN ('processing','ready') AND updated_at > ?
    UNION SELECT j.value FROM job, json_tree(job.payload_json, '$.result') AS j WHERE job.lane = 'media' AND job.state = 'done' AND job.finished_at > ? AND j.type = 'text' AND length(j.value) = 64`;
  const recent = new Date(Date.now() - 7 * DAY).toISOString();
  const marked = ctx.writeSync((tx) => {
    tx.run(`UPDATE blob SET unreferenced_since = NULL WHERE unreferenced_since IS NOT NULL AND sha256 IN (${used})`, recent, recent);
    return tx.run(`UPDATE blob SET unreferenced_since = ? WHERE unreferenced_since IS NULL AND origin <> 'builtin' AND sha256 NOT IN (${used})`, now, recent, recent);
  });
  // Deleted 24 h after it was last seen unreferenced. With an unsure clock nothing is deleted.
  let deleted = 0;
  if (ctx.clockTrust() !== 'unsure') {
    const victims = ctx.db.all<{ sha256: string; rel_path: string }>('SELECT sha256, rel_path FROM blob WHERE unreferenced_since IS NOT NULL AND unreferenced_since < ? LIMIT 2000', new Date(Date.now() - DAY).toISOString());
    for (let at = 0; at < victims.length; at += BATCH) {
      const slice = victims.slice(at, at + BATCH);
      // The row goes first (one short transaction, re-checked inside it); then the files, outside any transaction.
      const gone = ctx.writeSync((tx) =>
        slice.filter((v) => {
          if (tx.get(`SELECT 1 FROM blob WHERE sha256 = ? AND unreferenced_since IS NOT NULL AND sha256 NOT IN (${used})`, v.sha256, recent, recent) === undefined) return false;
          // Old or abandoned uploads may still name the file (upload.blob_sha256 is a foreign key): they let go of it first.
          tx.run('UPDATE upload SET blob_sha256 = NULL WHERE blob_sha256 = ?', v.sha256);
          return tx.run('DELETE FROM blob WHERE sha256 = ?', v.sha256) === 1;
        }),
      );
      for (const v of gone) rmSync(join(ctx.paths.media, v.rel_path), { force: true });
      deleted += gone.length;
      await sleep(PAUSE_MS);
    }
  }
  // Animation packages that no lesson uses, a week after they were unpacked.
  const packs = ctx.db.all<{ id: string; dir_name: string }>('SELECT id, dir_name FROM tryit_package WHERE lesson_id IS NULL AND created_at < ?', recent);
  for (const pack of packs) {
    ctx.writeSync((tx) => tx.run('DELETE FROM tryit_package WHERE id = ? AND lesson_id IS NULL', pack.id));
    if (/^tp-[a-z2-7]{26}$/.test(pack.dir_name)) removeQuietly(join(ctx.paths.tryit, pack.dir_name));
  }
  // Orphan files moved aside at boot: 7 days. Corrupt database copies: 90 days (V-013).
  const sweepOld = (dir: string, pattern: RegExp, maxAgeMs: number): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!pattern.test(name)) continue;
      try {
        if (Date.now() - statSync(join(dir, name)).mtimeMs > maxAgeMs) removeQuietly(join(dir, name));
      } catch {
        // vanished
      }
    }
  };
  sweepOld(ctx.paths.mediaOrphans, /./, 7 * DAY);
  sweepOld(ctx.paths.dbDir, /^corrupt-/, 90 * DAY);
  return { marked, deleted };
}

/* ---- health sample (hourly, kept 30 days) ---- */
export function sampleHealth(ctx: Ctx): boolean {
  const last = ctx.db.value<string>('SELECT max(at) FROM health_sample');
  if (last && Date.now() - Date.parse(last) < HOUR && Date.now() >= Date.parse(last)) return false;
  let temp: number | null = null;
  let throttled: string | null = null;
  try {
    temp = Math.round(Number(readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim()) / 100) / 10;
  } catch {
    temp = null;
  }
  try {
    throttled = /0x[0-9a-fA-F]+/.exec(execFileSync('vcgencmd', ['get_throttled'], { encoding: 'utf8', timeout: 3000 }))?.[0] ?? null;
  } catch {
    throttled = null;
  }
  const size = (file: string): number => {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  };
  ctx.writeSync((tx) =>
    tx.run(
      'INSERT OR REPLACE INTO health_sample (at, boot_id, cpu_temp_c, throttled_bits, load1, mem_available_mb, disk_free_bytes, db_bytes, wal_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      nowIso(),
      ctx.boot.bootId,
      temp,
      throttled,
      Math.round((os.loadavg()[0] ?? 0) * 100) / 100,
      Math.round(os.freemem() / (1024 * 1024)),
      diskSpace(ctx.paths.data)?.availableBytes ?? null,
      size(ctx.paths.mainDb),
      size(`${ctx.paths.mainDb}-wal`),
    ),
  );
  return true;
}

/* ---- weekly integrity check, on a fresh snapshot (DATABASE §9.1) ---- */
export function weeklyIntegrity(ctx: Ctx): boolean | null {
  const last = getSetting<string>(ctx, 'db.last_integrity_check_at');
  if (last && Date.now() - Date.parse(last) < 7 * DAY && Date.now() >= Date.parse(last)) return null;
  const newest = listSnapshots(ctx.paths).find((s) => s.kind === 'auto');
  if (!newest) return null;
  let ok = snapshotIsSound(newest.path);
  // A failing copy triggers the check of the live file at once.
  if (!ok) ok = checkDatabase(ctx.db, true);
  setSetting(ctx, 'db.last_integrity_check_at', nowIso());
  if (!ok) log('integrity.failed', { snapshot: newest.name });
  return ok;
}

export async function runMaintenance(ctx: Ctx): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  const step = async (name: string, work: () => unknown): Promise<void> => {
    try {
      report[name] = (await work()) ?? true;
    } catch (error) {
      report[name] = 'failed';
      logError(`maint.${name}`, error);
    }
  };
  await step('secrets', () => sweepSecrets(ctx));
  await step('recheck', () => recheckExports(ctx));
  await step('expire', () => expireExports(ctx));
  await step('retention', () => runRetention(ctx));
  await step('snapshot', () => snapshotIfDue(ctx));
  await step('prune', () => pruneTables(ctx));
  await step('counts', () => maintainCounts(ctx));
  await step('garbage', () => collectGarbage(ctx));
  await step('health', () => sampleHealth(ctx));
  await step('integrity', () => weeklyIntegrity(ctx));
  // Only when no job runs: a long reader would make TRUNCATE wait, and it gives up after 100 ms anyway.
  await step('checkpoint', () => {
    if (ctx.db.get("SELECT 1 FROM job WHERE state = 'running'")) return 'skipped';
    truncateCheckpoint(ctx.paths.mainDb);
    return true;
  });
  log('maint.done', report);
  return report;
}
