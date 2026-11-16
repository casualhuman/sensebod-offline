/*
 * Uploads (ADR-006, R-1). No body parser runs on these routes: the request
 * stream is piped to a file in bounded pieces with back-pressure, and a chunk
 * is fsynced BEFORE its bytes are counted in the database and before the
 * answer goes out. After a power cut the database value is the truth and the
 * .part file is cut back to it (boot recovery), so a phone resumes from the
 * last confirmed chunk.
 *
 *   POST /admin/uploads               one request (small files; 2 GiB during the transition)
 *   POST /admin/uploads/resumable     declare a file (JSON; mounted after the JSON reader)
 *   PUT  /admin/uploads/{id}/bytes    the next chunk, Content-Range: bytes a-b/total
 *   GET / DELETE /admin/uploads/{id}
 *   POST /admin/pictures?alt=         a gallery picture (JPEG, PNG, WebP; never SVG)
 *
 * Hashing, moving into the media store and every conversion happen in the
 * worker, not here.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, rmSync, statSync, truncateSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type Request } from 'express';
import type { Ctx, Tx } from '../core/context.ts';
import { ApiError, asObject, busy, conflict, invalid, notFound, storageFull, tooLarge, unsupportedFile } from '../core/errors.ts';
import { ensureDir } from '../core/fsx.ts';
import { pathParam, queryString, sendJson, sendNoContent, type AdminIdentity } from '../core/http.ts';
import { actorScope, beginIdempotent } from '../core/idempotency.ts';
import { newId } from '../core/ids.ts';
import { nowIso } from '../core/time.ts';
import { requireAdmin } from '../identity/sessions.ts';
import { usableBytes } from '../system/routes.ts';
import { enqueueJob } from '../worker/queue.ts';
import type { UploadRow } from './attach.ts';
import { insertBlob, storeFile } from './store.ts';
import { classify, refusalFor, sniffMatches, workingNote, type FileClass } from './types.ts';

export function partPath(ctx: Ctx, uploadId: string): string {
  return join(ctx.paths.uploadsPartial, `${uploadId}.part`);
}

export function uploadBody(row: UploadRow) {
  let checks: unknown[] = [];
  try {
    checks = JSON.parse(row.checks_json) as unknown[];
  } catch {
    checks = [];
  }
  const working = row.state === 'receiving' || row.state === 'processing';
  return {
    id: row.id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    receivedBytes: row.received_bytes,
    state: row.state,
    kind: row.kind,
    becomes: row.becomes,
    durationSeconds: row.duration_seconds,
    pages: row.pages,
    processing: {
      state: working ? 'working' : row.state === 'ready' ? 'ready' : 'failed',
      note: row.processing_note ?? (working ? workingNote(row.kind, row.smaller_copy === 1) : row.state === 'ready' ? 'Ready on this bag.' : 'The bag could not get this file ready.'),
    },
    checks,
  };
}

function fileNameOf(req: Request): string {
  const raw = req.headers['x-file-name'];
  let name = '';
  try {
    name = typeof raw === 'string' ? decodeURIComponent(raw) : '';
  } catch {
    name = '';
  }
  // Display and search only. Path separators and control characters are dropped all the same.
  name = name.replace(/[\\/]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, 512);
  if (!name) throw invalid('The file has no name.', { file: 'Choose the file again.' });
  return name;
}

function accepted(ctx: Ctx, fileName: string): FileClass {
  const refusal = refusalFor(fileName, ctx.config.uploads.h5pPlayer);
  const file = classify(fileName);
  if (refusal || !file) throw unsupportedFile(refusal ?? undefined);
  return file;
}

function assertSpace(ctx: Ctx, neededBytes: number): void {
  const usable = usableBytes(ctx);
  // Declared size + the reserve against free space (D-6.2f): progress writes must keep working when media fills the card.
  if (usable !== null && neededBytes > usable) throw storageFull(neededBytes, Math.max(0, usable));
}

function insertUpload(tx: Tx, admin: AdminIdentity, file: FileClass, fileName: string, mimeType: string, sizeBytes: number, smallerCopy: boolean): UploadRow {
  const id = newId('up');
  const now = nowIso();
  tx.run(
    `INSERT INTO upload (id, file_name, mime_type, size_bytes, received_bytes, state, kind, becomes, pages, smaller_copy, checks_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'receiving', ?, ?, ?, ?, '[]', ?, ?, ?)`,
    id,
    fileName,
    mimeType.slice(0, 100) || file.mimeType,
    sizeBytes,
    file.kind,
    file.becomes,
    file.kind === 'photo' ? 1 : null,
    smallerCopy && file.kind === 'video' ? 1 : 0,
    admin.id,
    now,
    now,
  );
  return tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', id) as UploadRow;
}

/** Counts bytes, refuses more than `limit`, and keeps the first bytes for sniffing. */
function meter(limit: number): { stream: Transform; bytes: () => number; head: () => Buffer } {
  let seen = 0;
  let head = Buffer.alloc(0);
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) {
        callback(tooLarge('More bytes arrived than were declared.'));
        return;
      }
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      callback(null, chunk);
    },
  });
  return { stream, bytes: () => seen, head: () => head };
}

export function uploadRoutes(ctx: Ctx): Router {
  const router = Router();
  const admin = requireAdmin(ctx);
  ensureDir(ctx.paths.uploadsPartial);
  /** Uploads being written right now: one writer per upload, and a cap on parallel streams (T-11). */
  const writing = new Set<string>();

  /**
   * Append `length` bytes of the request body to the upload's .part file at
   * `start`, fsync, then commit the new received_bytes. Returns the row.
   */
  async function receive(req: Request, upload: UploadRow, file: FileClass, start: number, length: number): Promise<UploadRow> {
    if (writing.has(upload.id)) throw new ApiError(409, 'in_progress', 'This file is already being sent.', { headers: { 'Retry-After': '2' } });
    if (writing.size >= ctx.config.server.maxUploadStreams) throw busy();
    writing.add(upload.id);
    const part = partPath(ctx, upload.id);
    try {
      // The database value is the truth: anything beyond it in the file was never confirmed.
      let onDisk = 0;
      try {
        onDisk = statSync(part).size;
      } catch {
        onDisk = 0;
      }
      if (onDisk < start) throw conflict('offset_mismatch', 'Send the file again from where the bag has it.', { receivedBytes: onDisk });
      if (onDisk > start) truncateSync(part, start);
      const counter = meter(length);
      await pipeline(req, counter.stream, createWriteStream(part, { flags: start === 0 ? 'w' : 'r+', start, highWaterMark: 256 * 1024 }));
      if (counter.bytes() !== length) {
        truncateSync(part, start);
        throw invalid('The file was cut off on the way. Try again.');
      }
      if (start === 0 && !sniffMatches(file.family, counter.head())) {
        rmSync(part, { force: true });
        await ctx.write((tx) => tx.run("UPDATE upload SET state = 'failed', processing_note = ?, updated_at = ? WHERE id = ?", 'The file is not what its name says.', nowIso(), upload.id));
        throw unsupportedFile('This file is not what its name says. Check the file and upload it again.');
      }
      // fsync BEFORE the bytes are counted and before the answer (R-1).
      const handle = await open(part, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return await ctx.write((tx) => {
        const received = start + length;
        const changed = tx.run("UPDATE upload SET received_bytes = ?, updated_at = ? WHERE id = ? AND state = 'receiving' AND received_bytes = ?", received, nowIso(), upload.id, start);
        if (changed !== 1) throw conflict('offset_mismatch', 'Send the file again from where the bag has it.', { receivedBytes: Number(tx.value('SELECT received_bytes FROM upload WHERE id = ?', upload.id) ?? 0) });
        if (received === upload.size_bytes) {
          // Complete: the worker hashes it, moves it into the store and converts it.
          tx.run("UPDATE upload SET state = 'processing', updated_at = ? WHERE id = ?", nowIso(), upload.id);
          enqueueJob(tx, 'inspect', 'media', { uploadId: upload.id });
        }
        return tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', upload.id) as UploadRow;
      });
    } catch (error) {
      // A broken connection is not an error of the upload: the phone asks where to continue.
      if ((error as { code?: string }).code === 'ERR_STREAM_PREMATURE_CLOSE' || (error as { code?: string }).code === 'ECONNRESET') {
        try {
          if (existsSync(part)) truncateSync(part, start);
        } catch {
          // boot recovery or the next chunk will cut it back
        }
        throw invalid('The file was cut off on the way. Try again.');
      }
      throw error;
    } finally {
      writing.delete(upload.id);
    }
  }

  /* ---- one request ---- */
  router.post('/admin/uploads', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const fileName = fileNameOf(req);
    const file = accepted(ctx, fileName);
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 1) throw invalid('The file is empty, or its size was not sent.', { file: 'Choose the file again.' });
    if (size > ctx.config.uploads.singleMaxBytes || size > ctx.config.limits.uploadMaxBytes) throw tooLarge('This file is too large to send in one go.');
    if (file.kind === 'animation' && size > ctx.config.limits.packageMaxBytes) throw tooLarge('This animation is too large. Ask EasySTEM for a smaller version.');
    assertSpace(ctx, size);
    const smallerCopy = queryString(req, 'smallerCopy') === 'true';
    const slot = await beginIdempotent(ctx, req, { scope: actorScope(req), required: false, fingerprint: JSON.stringify([fileName, size, smallerCopy]) });
    if (slot.replay) {
      req.resume();
      sendJson(res, slot.replay.status, slot.replay.body);
      return;
    }
    let created: UploadRow | null = null;
    try {
      created = await ctx.write((tx) => insertUpload(tx, who, file, fileName, String(req.headers['content-type'] ?? ''), size, smallerCopy));
      const done = await receive(req, created, file, 0, size);
      const body = uploadBody(done);
      await ctx.write((tx) => {
        tx.audit({ actorId: who.id, actorName: who.username, action: 'upload.create', targetType: 'upload', targetId: done.id, detail: { kind: done.kind, sizeBytes: size }, clientIp: req.sb.ip });
        slot.complete(tx, { status: 201, body });
      });
      sendJson(res, 201, body);
    } catch (error) {
      await slot.abort();
      // A single request cannot be resumed: nothing of it is kept.
      if (created) {
        const id = created.id;
        rmSync(partPath(ctx, id), { force: true });
        await ctx.write((tx) => tx.run("UPDATE upload SET state = 'abandoned', updated_at = ? WHERE id = ? AND state = 'receiving'", nowIso(), id)).catch(() => undefined);
      }
      throw error;
    }
  });

  /* ---- the next chunk of a resumable upload ---- */
  router.put('/admin/uploads/:uploadId/bytes', admin, async (req, res) => {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(req.headers['content-range'] ?? ''));
    if (!match) throw invalid('The chunk did not say which bytes it holds.', { 'Content-Range': 'Use bytes <start>-<end>/<total>.' });
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    const length = end - start + 1;
    const upload = ctx.db.get<UploadRow>('SELECT * FROM upload WHERE id = ?', pathParam(req, 'uploadId'));
    if (!upload || upload.state === 'abandoned') throw notFound('This file');
    if (!Number.isSafeInteger(length) || length < 1 || end >= total || total !== upload.size_bytes) throw invalid('The chunk does not fit this file.', { 'Content-Range': 'Check the byte range.' });
    if (length > ctx.config.limits.chunkMaxBytes) throw tooLarge('This chunk is too large. Send smaller pieces.');
    if (Number(req.headers['content-length']) !== length) throw invalid('The chunk is not as long as it says.', { 'Content-Length': 'Check the chunk.' });
    // Resending a range the bag already has is answered like a mismatch, so retries are safe.
    if (upload.state !== 'receiving' || start !== upload.received_bytes) throw conflict('offset_mismatch', 'Send the file again from where the bag has it.', { receivedBytes: upload.received_bytes });
    const file = classify(upload.file_name);
    if (!file) throw unsupportedFile();
    sendJson(res, 200, uploadBody(await receive(req, upload, file, start, length)));
  });

  router.get('/admin/uploads/:uploadId', admin, (req, res) => {
    const upload = ctx.db.get<UploadRow>('SELECT * FROM upload WHERE id = ?', pathParam(req, 'uploadId'));
    if (!upload) throw notFound('This file');
    sendJson(res, 200, uploadBody(upload));
  });

  router.delete('/admin/uploads/:uploadId', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'uploadId');
    if (writing.has(id)) throw new ApiError(409, 'in_progress', 'This file is still being sent.', { headers: { 'Retry-After': '2' } });
    const existed = await ctx.write((tx) => {
      const changed = tx.run("UPDATE upload SET state = 'abandoned', updated_at = ? WHERE id = ? AND state <> 'abandoned'", nowIso(), id);
      if (changed === 1) {
        // Conversions that have not started are pointless now. A stored file stays until nothing uses it (garbage collection).
        tx.run("UPDATE job SET state = 'cancelled', finished_at = ? WHERE state = 'queued' AND lane = 'media' AND json_extract(payload_json, '$.uploadId') = ?", nowIso(), id);
        tx.audit({ actorId: who.id, actorName: who.username, action: 'upload.delete', targetType: 'upload', targetId: id, clientIp: req.sb.ip });
      }
      return changed === 1;
    });
    if (existed && /^up-[a-z2-7]{26}$/.test(id)) rmSync(partPath(ctx, id), { force: true });
    sendNoContent(res);
  });

  /* ---- a gallery picture ---- */
  router.post('/admin/pictures', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const alt = (queryString(req, 'alt') ?? '').trim();
    if (!alt) throw invalid('Say what the photo shows, for people who cannot see it.', { alt: 'Describe the photo.' });
    if (alt.length > 200) throw invalid('Use a shorter description.', { alt: 'Use up to 200 letters.' });
    const fileName = fileNameOf(req);
    const file = classify(fileName);
    // No SVG: it can carry script (Reviewer B B-03).
    if (!file || file.kind !== 'photo' || file.blobExt === null) throw unsupportedFile('Choose a photo (JPG, PNG or WebP).');
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 1) throw invalid('The photo is empty, or its size was not sent.', { file: 'Choose the photo again.' });
    if (size > ctx.config.limits.pictureMaxBytes) throw tooLarge('This photo is too large. Use a photo under 10 MB.');
    assertSpace(ctx, size);
    if (writing.size >= ctx.config.server.maxUploadStreams) throw busy();
    const slot = await beginIdempotent(ctx, req, { scope: actorScope(req), required: false, fingerprint: JSON.stringify([fileName, size, alt]) });
    if (slot.replay) {
      req.resume();
      sendJson(res, slot.replay.status, slot.replay.body);
      return;
    }
    const key = `picture-${newId('pi')}`;
    const tmp = join(ctx.paths.uploadsPartial, `${key}.part`);
    writing.add(key);
    try {
      const counter = meter(size);
      const hash = createHash('sha256');
      const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(req, counter.stream, hasher, createWriteStream(tmp, { flags: 'w' }));
      if (counter.bytes() !== size) throw invalid('The photo was cut off on the way. Try again.');
      if (!sniffMatches(file.family, counter.head())) throw unsupportedFile('This file is not a photo. Choose a JPG, PNG or WebP photo.');
      const stored = await storeFile(ctx.paths, tmp, hash.digest('hex'), size, file.blobExt, 'upload', true);
      const body = await ctx.write((tx) => {
        insertBlob(tx, stored);
        const rel = (tx.get<{ rel_path: string }>('SELECT rel_path FROM blob WHERE sha256 = ?', stored.sha256) as { rel_path: string }).rel_path;
        const id = newId('pi');
        tx.run("INSERT INTO picture (id, grp, blob_sha256, alt, created_at, seq) VALUES (?, 'own', ?, ?, ?, ?)", id, stored.sha256, alt, nowIso(), tx.seq());
        tx.audit({ actorId: who.id, actorName: who.username, action: 'picture.create', targetType: 'picture', targetId: id, clientIp: req.sb.ip });
        const created = { id, group: 'own', url: `/media/${rel}`, alt };
        slot.complete(tx, { status: 201, body: created });
        return created;
      });
      sendJson(res, 201, body);
    } catch (error) {
      await slot.abort();
      const code = (error as { code?: string }).code;
      if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET') throw invalid('The photo was cut off on the way. Try again.');
      throw error;
    } finally {
      writing.delete(key);
      rmSync(tmp, { force: true });
    }
  });

  return router;
}

/** Routes of the upload family that take a JSON body; mounted after the JSON reader. */
export function uploadJsonRoutes(ctx: Ctx): Router {
  const router = Router();
  router.post('/admin/uploads/resumable', requireAdmin(ctx), async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const input = asObject(req.sb.body);
    const fileName = typeof input.fileName === 'string' ? input.fileName.replace(/[\\/]/g, ' ').trim().slice(0, 512) : '';
    if (!fileName) throw invalid('The file has no name.', { fileName: 'Choose the file again.' });
    const file = accepted(ctx, fileName);
    const size = input.sizeBytes;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) throw invalid('The file is empty, or its size was not sent.', { sizeBytes: 'Choose the file again.' });
    if (size > ctx.config.limits.uploadMaxBytes) throw tooLarge('This file is too large for the bag (the limit is 2 GB).');
    if (file.kind === 'animation' && size > ctx.config.limits.packageMaxBytes) throw tooLarge('This animation is too large. Ask EasySTEM for a smaller version.');
    assertSpace(ctx, size);
    const slot = await beginIdempotent(ctx, req, { scope: actorScope(req), required: true });
    if (slot.replay) {
      sendJson(res, slot.replay.status, slot.replay.body);
      return;
    }
    try {
      const body = await ctx.write((tx) => {
        const row = insertUpload(tx, who, file, fileName, typeof input.mimeType === 'string' ? input.mimeType : '', size, input.smallerCopy === true);
        tx.audit({ actorId: who.id, actorName: who.username, action: 'upload.create', targetType: 'upload', targetId: row.id, detail: { kind: row.kind, sizeBytes: size, resumable: true }, clientIp: req.sb.ip });
        const created = { ...uploadBody(row), chunkBytes: ctx.config.limits.chunkBytes };
        slot.complete(tx, { status: 201, body: created });
        return created;
      });
      sendJson(res, 201, body);
    } catch (error) {
      await slot.abort();
      throw error;
    }
  });
  return router;
}
