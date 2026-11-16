/*
 * exports routes (DATA-EXPORT-AND-BACKUP): learner-data downloads, backups,
 * diagnostics, download tickets, checks, and the USB stick.
 *
 * The API only decides, records and queues; a job process of the worker makes
 * the file (data lane for downloads, usb lane for anything on a stick).
 *
 * The one-time zip password never touches SQLite or the idempotency record
 * (V-004): it is written to a tmpfs file for the job and shown once, in the
 * 202 answer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import { bootUptimeS, type Ctx, type Tx } from '../core/context.ts';
import { ApiError, asObject, conflict, forbidden, invalid, notFound, storageFull, unauthorised } from '../core/errors.ts';
import { removeQuietly, writeFileDurable } from '../core/fsx.ts';
import { paging, pathParam, queryString, sendJson, sendNoContent, type AdminIdentity } from '../core/http.ts';
import { actorScope, beginIdempotent } from '../core/idempotency.ts';
import { newId } from '../core/ids.ts';
import { nowIso } from '../core/time.ts';
import { requireAdmin, requireConfirmed, resolveSession } from '../identity/sessions.ts';
import { startUnit } from '../system/privileged.ts';
import { usableBytes } from '../system/routes.ts';
import { enqueueJob } from '../worker/queue.ts';
import { PACK_DIR, RELEASE_FILE, readUsbJson, usbState, usbWritable } from './usb.ts';
import { generatePassword } from './words.ts';

const KINDS = ['learner-data', 'backup-records', 'backup-full', 'diagnostics'];
const EXPORTS_CAP_BYTES = 2 * 1024 ** 3;
const DIAGNOSTICS_ESTIMATE = 20 * 1024 ** 2;
/** Files kept at once per kind; one more deletes the oldest ready one (DATA-EXPORT §8). */
const MAX_KEPT: Record<string, number> = { 'learner-data': 3, 'backup-records': 2, diagnostics: 2 };

export interface ExportRow {
  id: string;
  kind: string;
  destination: 'download' | 'usb';
  state: string;
  options_json: string;
  job_id: string | null;
  created_by: string;
  created_at: string;
  ready_at: string | null;
  expires_at: string | null;
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  row_counts_json: string | null;
  error_code: string | null;
  download_count: number;
  received_checked_at: string | null;
  saved_checked_at: string | null;
  progress?: number | null;
  creator?: string | null;
}

const SELECT = `SELECT e.*, j.progress AS progress, coalesce(a.display_name, e.created_by) AS creator
  FROM export e LEFT JOIN job j ON j.id = e.job_id LEFT JOIN admin_account a ON a.id = e.created_by`;

export function secretPath(ctx: Ctx, exportId: string): string {
  return join(ctx.paths.exportSecrets, exportId);
}

function exportBody(ctx: Ctx, row: ExportRow) {
  const options = JSON.parse(row.options_json) as Record<string, unknown>;
  const finished = row.state === 'ready' || row.state === 'checking' || row.state === 'copied-to-usb';
  return {
    id: row.id,
    kind: row.kind,
    destination: row.destination,
    state: row.state,
    progress: finished ? 100 : (row.progress ?? 0),
    options: {
      includeNames: options.includeNames === true,
      includeChildProtectionCounts: options.includeChildProtectionCounts !== false,
      encrypted: options.encrypted !== false,
      namesOverWifi: options.namesOverWifi === true,
      from: typeof options.from === 'string' ? options.from : null,
      to: typeof options.to === 'string' ? options.to : null,
    },
    createdAt: row.created_at,
    createdBy: row.creator ?? row.created_by,
    readyAt: row.ready_at,
    expiresAt: row.expires_at,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    // First 12 hex characters in groups of four, for reading aloud over a phone call.
    checkCode: row.sha256 ? (row.sha256.slice(0, 12).toUpperCase().match(/.{4}/g) ?? []).join(' ') : null,
    rowCounts: row.row_counts_json ? (JSON.parse(row.row_counts_json) as Record<string, number>) : null,
    errorCode: row.error_code,
    downloadCount: row.download_count,
    receivedCheckedAt: row.received_checked_at,
    savedCheckedAt: row.saved_checked_at,
    clockTrust: ctx.clockTrust(),
  };
}

function findExport(db: { get: Tx['get'] }, id: string): ExportRow {
  const row = db.get<ExportRow>(`${SELECT} WHERE e.id = ?`, id);
  if (!row) throw notFound('This download');
  return row;
}

function day(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw invalid('That date is not readable.', { [field]: 'Use a date like 2026-11-13.' });
  return value;
}

/* ---- download tickets (DATA-EXPORT §7.2) ---- */

function sign(ctx: Ctx, payload: string): string {
  return createHmac('sha256', ctx.keys.ticket).update(payload).digest('base64url');
}

/** Valid for 30 minutes of uptime and only within this boot: no wall clock is involved (V-012). */
function makeTicket(ctx: Ctx, exportId: string, adminId: string): { ticket: string; expiresInS: number } {
  const expiresInS = ctx.config.exports.ticketMinutes * 60;
  const payload = [exportId, adminId, ctx.boot.bootId, String(bootUptimeS() + expiresInS)].join('|');
  return { ticket: `${Buffer.from(payload).toString('base64url')}.${sign(ctx, payload)}`, expiresInS };
}

function ticketAllows(ctx: Ctx, ticket: string, exportId: string): boolean {
  const dot = ticket.indexOf('.');
  if (dot < 1 || ticket.length > 600) return false;
  let payload: string;
  try {
    payload = Buffer.from(ticket.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const given = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(sign(ctx, payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const [id, , bootId, expiry] = payload.split('|');
  return id === exportId && bootId === ctx.boot.bootId && Number(expiry) > bootUptimeS();
}

/** On a laptop there is no nginx to hand the file to: serve it here, with Range. */
function serveDirect(req: Request, res: Response, file: string, size: number, etag: string): void {
  const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
  const ifRange = req.headers['if-range'];
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  if (range && (ifRange === undefined || ifRange === etag)) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`).setHeader('Content-Length', String(end - start + 1));
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.status(200).setHeader('Content-Length', String(size));
  createReadStream(file).pipe(res);
}

export function exportRoutes(ctx: Ctx): Router {
  const router = Router();
  const admin = requireAdmin(ctx);
  const hubManager = requireAdmin(ctx, 'hub-manager');

  const usbJobActive = (): boolean => ctx.db.get("SELECT 1 FROM job WHERE lane = 'usb' AND state IN ('queued','running')") !== undefined;

  router.get('/admin/exports', admin, (req, res) => {
    const { page, pageSize, offset } = paging(req);
    sendJson(res, 200, {
      items: ctx.db.all<ExportRow>(`${SELECT} ORDER BY e.created_at DESC, e.id LIMIT ? OFFSET ?`, pageSize, offset).map((row) => exportBody(ctx, row)),
      page,
      pageSize,
      total: Number(ctx.db.value('SELECT count(*) FROM export') ?? 0),
    });
  });

  router.post('/admin/exports', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const input = asObject(req.sb.body);
    const kind = input.kind as string;
    const destination = input.destination;
    if (KINDS.indexOf(kind) === -1) throw invalid('Choose what to make.', { kind: 'Choose a kind of download.' });
    if (destination !== 'download' && destination !== 'usb') throw invalid('Choose where it goes.', { destination: 'Choose this phone or the USB stick.' });
    const learnerData = kind === 'learner-data';
    const options = {
      includeNames: learnerData && input.includeNames === true,
      includeChildProtectionCounts: learnerData && input.includeChildProtectionCounts !== false,
      // Learner data is always password-protected; backups are always encrypted to EasySTEM; diagnostics hold no personal data.
      encrypted: kind !== 'diagnostics',
      namesOverWifi: learnerData && input.includeNames === true && input.namesOverWifi === true,
      from: learnerData ? day(input.from, 'from') : null,
      to: learnerData ? day(input.to, 'to') : null,
    };
    const refuse = async (error: ApiError, reason: string): Promise<never> => {
      await ctx.write((tx) => tx.audit({ actorId: who.id, actorName: who.username, action: 'export.create', outcome: 'refused', detail: { kind, destination, ...options, reason }, clientIp: req.sb.ip })).catch(() => undefined);
      throw error;
    };
    if (learnerData && input.encrypted === false) await refuse(invalid('Downloads with learner data are always protected with a password.', { encrypted: 'The password cannot be switched off.' }), 'unencrypted');
    if (kind === 'backup-full' && destination !== 'usb') await refuse(invalid('A backup of everything is too large for a phone. Use a USB stick.', { destination: 'Choose the USB stick.' }), 'full_needs_usb');
    if (options.includeNames) {
      // Names: a fresh password entry, and a stick unless the warning was accepted (V-005).
      requireConfirmed(req);
      if (destination !== 'usb' && !options.namesOverWifi) await refuse(new ApiError(422, 'names_need_usb', 'Files with names go on a USB stick. Plug one in, or choose to send it over the Wi-Fi anyway.'), 'names_need_usb');
    }
    if (kind === 'backup-records' || kind === 'backup-full') {
      if (!existsSync(ctx.config.paths.recipientsFile)) await refuse(conflict('conflict', 'This bag does not have the backup key from EasySTEM yet. Ask EasySTEM.'), 'no_recipients');
    }
    if (destination === 'usb' && !(await usbWritable(ctx)).ok) await refuse(conflict('conflict', 'Plug a USB stick into the bag, then try again.'), 'no_stick');

    // Space on the bag (DATA-EXPORT §8): the snapshot, the file, and the reserve.
    const dbBytes = statSync(ctx.paths.mainDb).size + (existsSync(ctx.paths.countsDb) ? statSync(ctx.paths.countsDb).size : 0);
    const needed = dbBytes + (destination === 'usb' ? 0 : kind === 'diagnostics' ? DIAGNOSTICS_ESTIMATE : dbBytes);
    const usable = usableBytes(ctx);
    if (usable !== null && needed > usable) await refuse(storageFull(needed, Math.max(0, usable)), 'no_space');
    const held = Number(ctx.db.value("SELECT coalesce(sum(size_bytes), 0) FROM export WHERE state IN ('ready','checking') AND destination = 'download'") ?? 0);
    if (destination === 'download' && held + needed > EXPORTS_CAP_BYTES) await refuse(storageFull(needed, Math.max(0, EXPORTS_CAP_BYTES - held)), 'exports_cap');

    const slot = await beginIdempotent(ctx, req, { scope: actorScope(req), required: true });
    if (slot.replay) {
      sendJson(res, slot.replay.status, slot.replay.body);
      return;
    }
    const id = newId('ex');
    const password = learnerData ? generatePassword() : null;
    const secret = secretPath(ctx, id);
    const dropFiles: string[] = [];
    try {
      // The password goes to tmpfs for the job (temp name + rename, 0600) BEFORE the row exists; it is never in SQLite.
      if (password !== null) writeFileDurable(secret, password, 0o600);
      const body = await ctx.write((tx) => {
        if (tx.get("SELECT 1 FROM export WHERE destination = ? AND state = 'preparing'", destination)) {
          throw conflict('export_in_progress', 'Another download is being prepared. Wait for it to finish.');
        }
        // Keeping one more than the limit removes the oldest ready one of that kind.
        const limit = MAX_KEPT[kind];
        if (destination === 'download' && limit !== undefined) {
          const ready = tx.all<{ id: string; file_name: string | null }>("SELECT id, file_name FROM export WHERE kind = ? AND destination = 'download' AND state IN ('ready','checking') ORDER BY ready_at DESC", kind);
          for (const old of ready.slice(limit - 1)) {
            tx.run("UPDATE export SET state = 'expired' WHERE id = ?", old.id);
            tx.audit({ actorId: 'system', actorName: 'system', action: 'export.expire', targetType: 'export', targetId: old.id, detail: { reason: 'max_kept' } });
            if (old.file_name) dropFiles.push(join(ctx.paths.exports, old.file_name));
          }
        }
        const lane = destination === 'usb' ? 'usb' : 'data';
        const jobKind = kind === 'learner-data' ? 'export_learner_data' : kind === 'backup-records' ? 'backup_records' : kind === 'backup-full' ? 'backup_full_usb' : 'diagnostics';
        const jobId = enqueueJob(tx, jobKind, lane, { exportId: id, destination, options });
        tx.run(
          "INSERT INTO export (id, kind, destination, state, options_json, job_id, created_by, created_at) VALUES (?, ?, ?, 'preparing', ?, ?, ?, ?)",
          id,
          kind,
          destination as string,
          JSON.stringify(options),
          jobId,
          who.id,
          nowIso(),
        );
        tx.audit({ actorId: who.id, actorName: who.username, action: 'export.create', targetType: 'export', targetId: id, detail: { kind, destination, ...options }, clientIp: req.sb.ip });
        const created = exportBody(ctx, findExport(tx, id));
        // The stored answer for replays carries no password (V-004).
        slot.complete(tx, { status: 202, body: created, stored: { ...created, password: null, passwordShown: password !== null } });
        return created;
      });
      for (const file of dropFiles) removeQuietly(file);
      sendJson(res, 202, password === null ? body : { ...body, password, passwordShown: false });
    } catch (error) {
      // The transaction failed after the secret was written: remove it before answering (V-021).
      removeQuietly(secret);
      await slot.abort();
      throw error;
    }
  });

  router.get('/admin/exports/:exportId', admin, (req, res) => {
    sendJson(res, 200, exportBody(ctx, findExport(ctx.db, pathParam(req, 'exportId'))));
  });

  router.delete('/admin/exports/:exportId', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'exportId');
    const file = await ctx.write((tx) => {
      const row = tx.get<ExportRow>('SELECT * FROM export WHERE id = ?', id);
      // Idempotent: nothing to do for what is gone or was never there.
      if (!row || row.state === 'deleted') return null;
      if (row.state === 'preparing') throw conflict('conflict', 'This download is still being prepared. Wait for it to finish, then delete it.');
      tx.run("UPDATE export SET state = 'deleted' WHERE id = ?", id);
      tx.audit({ actorId: who.id, actorName: who.username, action: 'export.delete', targetType: 'export', targetId: id, clientIp: req.sb.ip });
      return row.destination === 'download' && row.file_name ? join(ctx.paths.exports, row.file_name) : null;
    });
    if (file) removeQuietly(file);
    sendNoContent(res);
  });

  router.post('/admin/exports/:exportId/download-link', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const row = findExport(ctx.db, pathParam(req, 'exportId'));
    if (row.state === 'checking') throw conflict('checking', 'The bag is checking this file after a power cut. Try again in a moment.');
    if (row.state !== 'ready' || row.destination !== 'download') throw new ApiError(410, 'expired', 'This download is no longer on the bag. Make it again.');
    const { ticket, expiresInS } = makeTicket(ctx, row.id, who.id);
    await ctx.write((tx) => tx.audit({ actorId: who.id, actorName: who.username, action: 'export.download_link', targetType: 'export', targetId: row.id, detail: { validMinutes: expiresInS / 60 }, clientIp: req.sb.ip }));
    sendJson(res, 200, { url: `/api/v1/admin/exports/${row.id}/file?ticket=${ticket}`, expiresAt: new Date(Date.now() + expiresInS * 1000).toISOString() });
  });

  // The ticket in the URL works with or without the cookie (some download managers do not send cookies).
  router.get('/admin/exports/:exportId/file', async (req, res) => {
    const id = pathParam(req, 'exportId');
    const ticket = queryString(req, 'ticket');
    let actor: { id: string; name: string } | null = null;
    if (ticket !== null) {
      if (!ticketAllows(ctx, ticket, id)) throw forbidden('ticket_invalid', 'This download link is no longer valid. Ask for a new one.');
    } else {
      const session = resolveSession(ctx, req);
      if (!session) throw unauthorised();
      if (session.mustChangePassword) throw forbidden('password_change_required', 'Choose a new password first.');
      req.sb.admin = session;
      actor = { id: session.id, name: session.username };
    }
    const row = findExport(ctx.db, id);
    if (row.state === 'checking') throw conflict('checking', 'The bag is checking this file after a power cut. Try again in a moment.');
    if (row.state !== 'ready' || row.destination !== 'download' || !row.file_name || row.size_bytes === null || row.sha256 === null) {
      throw new ApiError(410, 'expired', 'This download is no longer on the bag. Make it again.');
    }
    const file = join(ctx.paths.exports, row.file_name);
    let size = -1;
    try {
      size = statSync(file).size;
    } catch {
      size = -1;
    }
    if (size !== row.size_bytes) throw new ApiError(410, 'expired', 'This download is no longer on the bag. Make it again.');
    // A request without Range, or starting at byte 0, is one download for the record (no IP: V-001).
    const range = String(req.headers.range ?? '');
    if (range === '' || /^bytes=0-/.test(range)) {
      await ctx.write((tx) => {
        tx.run('UPDATE export SET download_count = download_count + 1, last_download_at = ? WHERE id = ?', nowIso(), id);
        tx.audit({ actorId: actor?.id ?? row.created_by, actorName: actor?.name ?? null, action: 'export.download', targetType: 'export', targetId: id, detail: { byTicket: ticket !== null } });
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', row.file_name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
    res.setHeader('X-Sensebod-Offline-SHA256', row.sha256);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (ctx.config.dev.serveFiles) {
      serveDirect(req, res, file, size, `"${row.sha256.slice(0, 32)}"`);
      return;
    }
    // nginx serves the bytes (Range, ETag, Content-Length); no backend handler is held for the download.
    res.setHeader('X-Accel-Redirect', `/_protected/exports/${row.file_name}`);
    res.status(200).end();
  });

  router.post('/admin/exports/:exportId/checks', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'exportId');
    const input = asObject(req.sb.body);
    if (input.stage !== 'received' && input.stage !== 'saved') throw invalid('Say which check this is.', { stage: 'Use received or saved.' });
    if (typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) throw invalid('The check code is not readable.', { sha256: 'Send the SHA-256 of the file.' });
    const body = await ctx.write((tx) => {
      const row = findExport(tx, id);
      if (row.sha256 === null) throw conflict('conflict', 'This download is not ready yet.');
      if (row.sha256 !== input.sha256) throw invalid(input.stage === 'saved' ? 'The saved file is not complete. Free some space on this phone and download it again.' : 'The file did not arrive whole. Download it again.', { sha256: 'The file is different from the one on the bag.' });
      const column = input.stage === 'saved' ? 'saved_checked_at' : 'received_checked_at';
      if ((input.stage === 'saved' ? row.saved_checked_at : row.received_checked_at) === null) {
        tx.run(`UPDATE export SET ${column} = ? WHERE id = ?`, nowIso(), id);
        tx.audit({ actorId: who.id, actorName: who.username, action: input.stage === 'saved' ? 'export.saved_checked' : 'export.received_checked', targetType: 'export', targetId: id, clientIp: req.sb.ip });
      }
      return exportBody(ctx, findExport(tx, id));
    });
    sendJson(res, 200, body);
  });

  /* ---------------- USB ---------------- */
  router.get('/admin/usb', admin, async (_req, res) => {
    sendJson(res, 200, await usbState(ctx));
  });

  router.post('/admin/usb/eject', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    if (usbJobActive()) throw conflict('conflict', 'The bag is still copying to the stick. Wait for it to finish.');
    const before = await readUsbJson(ctx);
    if (before && before.state !== 'none' && before.state !== 'ejected') {
      await startUnit(ctx, 'sensebod-offline-usb-eject.service', { wait: true, timeoutMs: 60_000 });
      await ctx.write((tx) => tx.audit({ actorId: who.id, actorName: who.username, action: 'usb.eject', detail: { label: before.label ?? null }, clientIp: req.sb.ip }));
    }
    sendJson(res, 200, await usbState(ctx));
  });

  router.post('/admin/usb/format', hubManager, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    requireConfirmed(req);
    const input = asObject(req.sb.body);
    if (input.confirm !== 'FORMAT') throw invalid('Type FORMAT to delete everything on the stick.', { confirm: 'Type FORMAT.' });
    if (input.label !== 'A' && input.label !== 'B') throw invalid('Choose stick A or stick B.', { label: 'Choose A or B.' });
    const usb = await readUsbJson(ctx);
    if (!usb || !usb.kernelName || !/^sd[a-z][0-9]*$/.test(usb.kernelName) || usb.state === 'none' || usb.state === 'ejected') throw conflict('conflict', 'Plug a USB stick into the bag, then try again.');
    const jobId = await ctx.write((tx) => {
      if (tx.get("SELECT 1 FROM job WHERE lane = 'usb' AND state IN ('queued','running')")) throw conflict('conflict', 'The bag is still using the stick. Wait for it to finish.');
      const id = enqueueJob(tx, 'usb_format', 'usb', { label: input.label, kernelName: usb.kernelName });
      tx.audit({ actorId: who.id, actorName: who.username, action: 'usb.format', detail: { label: input.label, stage: 'requested' }, clientIp: req.sb.ip });
      return id;
    });
    sendJson(res, 202, { jobId });
  });

  router.post('/admin/usb/check', hubManager, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    if (!(await usbWritable(ctx)).ok && (await readUsbJson(ctx))?.state !== 'read-only') throw conflict('conflict', 'Plug a USB stick into the bag, then try again.');
    const jobId = await ctx.write((tx) => {
      if (tx.get("SELECT 1 FROM job WHERE lane = 'usb' AND state IN ('queued','running')")) throw conflict('conflict', 'The bag is still using the stick. Wait for it to finish.');
      const id = enqueueJob(tx, 'usb_check', 'usb', {});
      tx.audit({ actorId: who.id, actorName: who.username, action: 'usb.check', detail: { stage: 'requested' }, clientIp: req.sb.ip });
      return id;
    });
    sendJson(res, 202, { jobId });
  });

  router.post('/admin/usb/packages/:packageName/install', hubManager, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const name = pathParam(req, 'packageName');
    const isPack = PACK_DIR.test(name);
    if (!isPack && !RELEASE_FILE.test(name)) throw notFound('This package');
    const listed = (await usbState(ctx)).packages.find((p) => p.name === name);
    if (!listed) throw notFound('This package');
    // Refused unless the signature is valid; the job verifies it again before it touches anything.
    if (!listed.signatureOk) throw conflict('conflict', 'This package is not signed by EasySTEM. It was not installed.');
    const jobId = await ctx.write((tx) => {
      if (tx.get("SELECT 1 FROM job WHERE lane = 'usb' AND state IN ('queued','running')")) throw conflict('conflict', 'The bag is still using the stick. Wait for it to finish.');
      const id = enqueueJob(tx, isPack ? 'content_pack_install' : 'release_stage', 'usb', { name });
      tx.audit({ actorId: who.id, actorName: who.username, action: isPack ? 'content_pack.install' : 'update.apply', detail: { name, stage: 'requested' }, clientIp: req.sb.ip });
      return id;
    });
    sendJson(res, 202, { jobId });
  });

  return router;
}
