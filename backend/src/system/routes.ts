/*
 * system routes: health, status, audit, storage, clock, power-off, and the
 * learner-data summary and cleaning (SYSTEM-ARCHITECTURE §5.7, DATA-EXPORT §8.1).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { Router } from 'express';
import { bootUptimeS, clockIsTrusted, readClockState, type Ctx } from '../core/context.ts';
import { ApiError, asObject, conflict, invalid, notFound } from '../core/errors.ts';
import { dirBytes, diskSpace } from '../core/fsx.ts';
import { paging, queryString, sendJson, type AdminIdentity } from '../core/http.ts';
import { newId } from '../core/ids.ts';
import { headState } from '../core/migrate.ts';
import { DAY, MINUTE, dayOf, daysBetween, nowIso } from '../core/time.ts';
import { listSnapshots, removeAutoSnapshots } from '../exports/snapshots.ts';
import { requireAdmin, requireConfirmed } from '../identity/sessions.ts';
import { deleteLearners, exportedSeq, lastExport, learnerAges, planRetention } from '../learners/retention.ts';
import { writeClockState } from './bootstrap.ts';
import { dropRequest, nonce, startUnit, writeRequest } from './privileged.ts';

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

let snapshotBytes: { at: number; bytes: number } | null = null;

/** Space used and left (D-6.1c). Values the bag cannot measure stay null. */
export function storageInfo(ctx: Ctx) {
  const space = diskSpace(ctx.paths.data);
  const reserve = ctx.config.limits.reserveBytes;
  const available = space ? space.availableBytes : null;
  const sum = (sql: string): number => Number(ctx.db.value(sql) ?? 0);
  const now = performance.now();
  if (!snapshotBytes || now - snapshotBytes.at > 60_000) snapshotBytes = { at: now, bytes: dirBytes(ctx.paths.snapshots) };
  return {
    usedBytes: space ? space.totalBytes - space.availableBytes : null,
    totalBytes: space ? space.totalBytes : null,
    availableBytes: available,
    reserveBytes: reserve,
    state: available === null ? 'ok' : available <= reserve ? 'full' : available <= ctx.config.limits.lowBytes ? 'low' : 'ok',
    breakdown: [
      { label: 'Lessons (media)', bytes: sum("SELECT coalesce(sum(size_bytes), 0) FROM blob WHERE origin <> 'derived'") },
      { label: 'Smaller copies', bytes: sum("SELECT coalesce(sum(size_bytes), 0) FROM blob WHERE origin = 'derived'") },
      { label: 'Uploads waiting', bytes: sum("SELECT coalesce(sum(received_bytes), 0) FROM upload WHERE state IN ('receiving','processing') AND blob_sha256 IS NULL") },
      { label: 'Database', bytes: fileSize(ctx.paths.mainDb) + fileSize(`${ctx.paths.mainDb}-wal`) + fileSize(ctx.paths.countsDb) + fileSize(`${ctx.paths.countsDb}-wal`) },
      { label: 'Downloads waiting on the bag', bytes: sum("SELECT coalesce(sum(size_bytes), 0) FROM export WHERE state IN ('ready','checking') AND destination = 'download'") },
      { label: 'Saved copies (snapshots)', bytes: snapshotBytes.bytes },
    ],
  };
}

/** Free space the bag may still use before it reaches its reserve; null when it cannot be measured. */
export function usableBytes(ctx: Ctx): number | null {
  const space = diskSpace(ctx.paths.data);
  return space ? space.availableBytes - ctx.config.limits.reserveBytes : null;
}

function temperatureC(): number | null {
  try {
    const milli = Number(readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim());
    return Number.isFinite(milli) ? Math.round(milli / 100) / 10 : null;
  } catch {
    return null;
  }
}

export function statusBody(ctx: Ctx) {
  const boot = ctx.db.get<{ previous_clean: number; recovery_note: string | null }>('SELECT previous_clean, recovery_note FROM boot WHERE boot_id = ?', ctx.boot.bootId);
  const health = ctx.db.get<{ throttled_bits: string | null; cpu_temp_c: number | null }>('SELECT throttled_bits, cpu_temp_c FROM health_sample WHERE boot_id = ? ORDER BY at DESC LIMIT 1', ctx.boot.bootId);
  const bits = health?.throttled_bits ? Number.parseInt(health.throttled_bits, 16) : 0;
  const newestSnapshot = listSnapshots(ctx.paths).find((s) => s.kind === 'auto');
  const integrity = ctx.db.value<string>("SELECT value_json FROM setting WHERE key = 'db.last_integrity_check_at'");
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  return {
    version: ctx.version,
    uptimeSeconds: bootUptimeS(),
    bootId: ctx.boot.bootId,
    previousShutdownClean: boot ? boot.previous_clean === 1 : ctx.boot.previousClean,
    clockTrust: ctx.clockTrust(),
    serverTime: nowIso(),
    storage: storageInfo(ctx),
    database: {
      sizeBytes: fileSize(ctx.paths.mainDb),
      walBytes: fileSize(`${ctx.paths.mainDb}-wal`),
      // The API only starts on a database that passed quick_check in boot recovery.
      lastQuickCheck: 'ok',
      lastIntegrityCheckAt: integrity ? (JSON.parse(integrity) as string) : null,
    },
    lastLocalSnapshotAt: newestSnapshot ? new Date(newestSnapshot.mtimeMs).toISOString() : null,
    lastOffBagBackupAt: lastExport(ctx.db).at,
    recovery: { restoredFrom: ctx.meta('restored_from') ?? null, note: boot?.recovery_note ?? null },
    jobs: ctx.db
      .all<{ id: string; kind: string; state: string; progress: number; error_code: string | null }>(
        "SELECT id, kind, state, progress, error_code FROM job WHERE state IN ('queued','running') OR created_at > ? ORDER BY created_at DESC LIMIT 20",
        new Date(Date.now() - DAY).toISOString(),
      )
      .map((j) => ({ id: j.id, kind: j.kind, state: j.state, progress: j.progress, errorCode: j.error_code })),
    power: { undervoltageSinceBoot: (bits & 0x10000) !== 0 || (bits & 0x1) !== 0, throttledNow: (bits & 0x4) !== 0 },
    temperatureC: temperatureC() ?? health?.cpu_temp_c ?? null,
    overrideNotices: ctx.db
      .all<{ id: string; username: string; used_at: string }>('SELECT id, username, used_at FROM override_notice WHERE acknowledged_at IS NULL ORDER BY used_at')
      .map((n) => ({ noticeId: n.id, username: n.username, usedAt: n.used_at })),
    clockChanges: ctx.db
      .all<{ at: string; actor_name: string | null; action: string; detail_json: string }>("SELECT at, actor_name, action, detail_json FROM audit_event WHERE action IN ('clock.set','clock.boot') AND at > ? ORDER BY id DESC LIMIT 50", since)
      .map((row) => {
        const detail = JSON.parse(row.detail_json) as { from?: string; to?: string; source?: string };
        return { at: row.at, from: detail.from ?? row.at, to: detail.to ?? row.at, source: detail.source ?? (row.action === 'clock.set' ? 'manual' : 'boot'), byUsername: row.action === 'clock.set' ? row.actor_name : null };
      }),
    childProtectionMode: ctx.config.childProtection.progressMode,
  };
}

export function systemRoutes(ctx: Ctx): Router {
  const router = Router();
  const admin = requireAdmin(ctx);
  const hubManager = requireAdmin(ctx, 'hub-manager');

  router.get('/health', (_req, res) => {
    const maintenance = ctx.inMaintenance();
    let ok = !maintenance;
    try {
      ok = ok && headState(ctx.db, 'main') === 'equal';
    } catch {
      ok = false;
    }
    if (!ok) {
      res.setHeader('Retry-After', '30');
      sendJson(res, 503, { error: { code: 'maintenance', message: 'The bag is being looked after. Please try again later.' } });
      return;
    }
    sendJson(res, 200, { ok: true, version: ctx.version, maintenance: false });
  });

  router.get('/admin/status', admin, (_req, res) => {
    sendJson(res, 200, statusBody(ctx));
  });

  router.get('/admin/storage', admin, (_req, res) => {
    sendJson(res, 200, storageInfo(ctx));
  });

  router.get('/admin/audit', hubManager, (req, res) => {
    const action = queryString(req, 'action');
    const { page, pageSize, offset } = paging(req);
    interface AuditRow {
      id: number;
      at: string;
      clock_trust: string;
      actor_name: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      outcome: string;
      detail_json: string;
    }
    const columns = 'id, at, clock_trust, actor_name, action, target_type, target_id, outcome, detail_json';
    // The filter matches an action or a family of actions ("export" finds export.create, export.ready…).
    const rows = action
      ? ctx.db.all<AuditRow>(`SELECT ${columns} FROM audit_event WHERE action = ? OR action LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ? OFFSET ?`, action, `${action.replace(/[\\%_]/g, (c) => `\\${c}`)}.%`, pageSize, offset)
      : ctx.db.all<AuditRow>(`SELECT ${columns} FROM audit_event ORDER BY id DESC LIMIT ? OFFSET ?`, pageSize, offset);
    const total = Number(
      (action ? ctx.db.value("SELECT count(*) FROM audit_event WHERE action = ? OR action LIKE ? ESCAPE '\\'", action, `${action.replace(/[\\%_]/g, (c) => `\\${c}`)}.%`) : ctx.db.value('SELECT count(*) FROM audit_event')) ?? 0,
    );
    sendJson(res, 200, {
      items: rows.map((row) => ({
        id: row.id,
        at: row.at,
        clockTrust: row.clock_trust,
        actorName: row.actor_name,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        outcome: row.outcome,
        detail: JSON.parse(row.detail_json) as unknown,
      })),
      page,
      pageSize,
      total,
    });
  });

  /* ---- clock (ADR-014, V-033, V-039) ---- */
  router.post('/admin/clock', hubManager, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const input = asObject(req.sb.body);
    const target = typeof input.clientTime === 'string' ? Date.parse(input.clientTime) : Number.NaN;
    if (!Number.isFinite(target) || target < Date.parse('2026-01-01T00:00:00Z') || target > Date.parse('2046-01-01T00:00:00Z')) {
      throw invalid("This phone's date does not look right. Check the phone's date and time, then try again.", { clientTime: "Check the phone's date." });
    }
    const before = Date.now();
    const trust = ctx.clockTrust();
    if (Math.abs(target - before) < 5 * MINUTE && clockIsTrusted(trust)) throw conflict('conflict', "The bag's clock is already right.");
    const from = new Date(before).toISOString();
    const to = new Date(target).toISOString();
    const days = Math.floor((target - before) / DAY);
    const previous = readClockState(ctx.paths);

    // 1. The change is recorded durably BEFORE it is applied (V-039): if the power fails in between, the next
    //    boot still knows this date was set by hand and does not trust it for expiry.
    writeClockState(ctx.paths, { trust: 'manual', handSetUnconfirmed: true, pending: { from, to, by: who.username, recordedAt: from } });
    ctx.forgetClockCache();
    await ctx.write((tx) => {
      // A manual forward step of more than 7 days never counts toward removing learner data until confirmed (V-033).
      if (days > 7) {
        tx.run("INSERT INTO clock_jump (id, at_uptime_s, from_time, to_time, days, source, by_admin) VALUES (?, ?, ?, ?, ?, 'manual', ?)", newId('cj'), ctx.uptimeTotalS(), from, to, days, who.id);
      }
      tx.audit({ actorId: who.id, actorName: who.username, action: 'clock.set', detail: { from, to, source: 'manual', days, trustBefore: trust }, clientIp: req.sb.ip });
    });

    // 2. Apply it through the root entry point.
    const requestNonce = nonce();
    const seconds = Math.floor(target / 1000);
    const request = writeRequest(ctx, requestNonce, { unixSeconds: seconds });
    try {
      await startUnit(ctx, `sensebod-offline-clock@${seconds}-${requestNonce}.service`, { wait: true });
    } catch (error) {
      dropRequest(request);
      writeClockState(ctx.paths, { ...previous, pending: null });
      ctx.forgetClockCache();
      await ctx.write((tx) => tx.audit({ actorId: who.id, actorName: who.username, action: 'clock.set', outcome: 'failed', detail: { from, to, source: 'manual' }, clientIp: req.sb.ip }));
      throw error;
    }
    dropRequest(request);
    // 3. Applied: the date stays `manual` until an independent source (NTP) confirms it.
    writeClockState(ctx.paths, { trust: 'manual', handSetUnconfirmed: true, pending: null });
    ctx.forgetClockCache();
    sendJson(res, 200, { serverTime: ctx.config.dev.fakePrivileged ? to : nowIso(), clockTrust: 'manual' });
  });

  /* ---- switch off safely ---- */
  router.post('/admin/power-off', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    if (existsSync(`${ctx.paths.update}/journal.json`) || existsSync(`${ctx.paths.restore}/state.json`)) {
      throw conflict('conflict', 'The bag is being updated. Wait until it has finished.');
    }
    await ctx.write((tx) => tx.audit({ actorId: who.id, actorName: who.username, action: 'power.off', clientIp: req.sb.ip }));
    res.status(202).setHeader('Cache-Control', 'no-store').end();
    // After the answer is on its way: the unit stops the services with bounded waits and powers off.
    setTimeout(() => {
      startUnit(ctx, 'sensebod-offline-poweroff.service', { wait: false }).catch(() => undefined);
    }, 500).unref();
  });

  /* ---- learner data: summary, date confirmation, cleaning ---- */
  router.get('/admin/learner-data/summary', admin, (_req, res) => {
    const db = ctx.db;
    const counts = db.get<{ learners: number; oldest: string | null; newest: string | null }>('SELECT count(*) AS learners, min(last_active_day) AS oldest, max(last_active_day) AS newest FROM learner') ?? {
      learners: 0,
      oldest: null,
      newest: null,
    };
    const upTo = exportedSeq(db);
    const last = lastExport(db);
    const plan = planRetention(db, ctx.config.retention);
    const jumps = db.all<{ id: string; days: number; to_time: string; source: string; confirmed_at: string | null }>('SELECT id, days, to_time, source, confirmed_at FROM clock_jump WHERE confirmed_at IS NULL ORDER BY to_time');
    sendJson(res, 200, {
      learners: counts.learners,
      learnersWithProgress: Number(db.value('SELECT count(DISTINCT learner_id) FROM lesson_progress') ?? 0),
      progressRecords: Number(db.value('SELECT count(*) FROM lesson_progress') ?? 0),
      childProtectionMode: ctx.config.childProtection.progressMode,
      oldestActivity: counts.oldest,
      newestActivity: counts.newest,
      clockTrust: ctx.clockTrust(),
      lastExportAt: last.at,
      lastExportKind: last.kind,
      unexportedLearners: learnerAges(db).filter((l) => l.last_seq > upTo).length,
      retentionDays: ctx.config.retention.learnerDays,
      nextAutomaticRemoval: plan.next,
      clockJumps: jumps.map((j) => ({ jumpId: j.id, days: j.days, at: j.to_time, source: j.source, wouldRemove: plan.blocked.get(j.id) ?? 0, confirmed: false })),
      retentionHeldBack: plan.heldBack,
    });
  });

  router.post('/admin/learner-data/confirm-date', hubManager, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    requireConfirmed(req);
    const input = asObject(req.sb.body);
    if (typeof input.jumpId !== 'string' || typeof input.dateIsRight !== 'boolean') throw invalid('Say whether the date is right.', { dateIsRight: 'Choose yes or no.' });
    await ctx.write((tx) => {
      const jump = tx.get<{ id: string; days: number; confirmed_at: string | null }>('SELECT id, days, confirmed_at FROM clock_jump WHERE id = ?', input.jumpId as string);
      if (!jump) throw notFound('This date change');
      if (input.dateIsRight === true && jump.confirmed_at === null) tx.run('UPDATE clock_jump SET confirmed_by = ?, confirmed_at = ? WHERE id = ?', who.id, nowIso(), jump.id);
      tx.audit({ actorId: who.id, actorName: who.username, action: 'clock.jump.confirmed', targetType: 'clock_jump', targetId: jump.id, outcome: input.dateIsRight === true ? 'ok' : 'refused', detail: { days: jump.days, dateIsRight: input.dateIsRight }, clientIp: req.sb.ip });
    });
    res.status(204).setHeader('Cache-Control', 'no-store').end();
  });

  router.post('/admin/learner-data/clean', hubManager, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    requireConfirmed(req);
    const input = asObject(req.sb.body);
    if (input.confirm !== 'CLEAN') throw invalid('Type CLEAN to remove learner data.', { confirm: 'Type CLEAN.' });
    if (input.scope !== 'all' && input.scope !== 'older-than') throw invalid('Choose which learner data to remove.', { scope: 'Choose all or older than.' });
    let days = 0;
    if (input.scope === 'older-than') {
      if (typeof input.days !== 'number' || !Number.isInteger(input.days) || input.days < 1 || input.days > 3650) throw invalid('Type a number of days.', { days: 'Use 1 to 3650.' });
      days = input.days;
      if (!clockIsTrusted(ctx.clockTrust()) && ctx.clockTrust() !== 'manual' && ctx.clockTrust() !== 'restored') {
        throw conflict('conflict', "Set the bag's clock first, so the bag knows which learners are old.");
      }
    }
    const today = dayOf();
    const upTo = exportedSeq(ctx.db);
    const chosen = learnerAges(ctx.db).filter((l) => days === 0 || daysBetween(l.last_active_day ?? l.created_at.slice(0, 10), today) >= days);
    const unexported = chosen.filter((l) => l.last_seq > upTo).length;
    if (unexported > 0 && input.acknowledgeUnexported !== true) {
      await ctx.write((tx) => tx.audit({ actorId: who.id, actorName: who.username, action: 'learner.clean', outcome: 'refused', detail: { scope: input.scope, days, unexported, reason: 'not_exported' }, clientIp: req.sb.ip }));
      throw new ApiError(409, 'not_exported', `${unexported} people have data that has not been exported. Export for EasySTEM first, or choose Remove anyway.`, { details: { unexportedLearners: unexported } });
    }
    let learnersRemoved = 0;
    let progressRemoved = 0;
    // Batches of 500 per transaction, each with secure_delete (DATABASE §4.3, V-013). Between batches other writes get their turn.
    for (let at = 0; at < chosen.length; at += 500) {
      const ids = chosen.slice(at, at + 500).map((l) => l.id);
      const removed = await ctx.write((tx) => deleteLearners(tx, ids), { secureDelete: true });
      learnersRemoved += removed.learners;
      progressRemoved += removed.progress;
    }
    // Removed names must not stay in the rotation copies: they go now, and maintenance takes a fresh one.
    const snapshotsRemoved = removeAutoSnapshots(ctx.paths);
    await ctx.write((tx) => {
      tx.run("INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES ('snapshot.requested', 'true', ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = 'true', updated_at = excluded.updated_at", nowIso(), who.id);
      tx.audit({
        actorId: who.id,
        actorName: who.username,
        action: 'learner.clean',
        detail: { scope: input.scope, days, learnersRemoved, progressRemoved, unexportedAcknowledged: unexported > 0, unexported, snapshotsRemoved },
        clientIp: req.sb.ip,
      });
    });
    sendJson(res, 200, { learnersRemoved, progressRemoved });
  });

  return router;
}
