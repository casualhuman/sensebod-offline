/*
 * media → catalog link: which files a lesson uses.
 *
 * A lesson remembers the uploads it was made from in body_json.uploadIds
 * (never sent to learners). Whenever something about those uploads changes
 * (the lesson is created, a conversion finishes or fails), the lesson's file
 * rows are rebuilt from the uploads and the results of their finished jobs.
 * The rebuild is idempotent: running it twice gives the same rows.
 */
import type { Tx } from '../core/context.ts';
import { nowIso } from '../core/time.ts';

export interface UploadRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  received_bytes: number;
  state: 'receiving' | 'processing' | 'ready' | 'failed' | 'abandoned';
  kind: string;
  becomes: string | null;
  duration_seconds: number | null;
  pages: number | null;
  smaller_copy: number;
  blob_sha256: string | null;
  processing_note: string | null;
  checks_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** What finished media jobs produced for one upload, merged. */
export interface UploadResults {
  smaller?: string;
  audio?: string;
  pages?: string[];
  blocks?: unknown[];
  package?: { id: string; url: string };
}

export function uploadResults(tx: Tx, uploadId: string): UploadResults {
  const rows = tx.all<{ payload_json: string }>("SELECT payload_json FROM job WHERE state = 'done' AND lane = 'media' AND json_extract(payload_json, '$.uploadId') = ? ORDER BY finished_at", uploadId);
  const out: UploadResults = {};
  for (const row of rows) {
    try {
      const result = (JSON.parse(row.payload_json) as { result?: UploadResults }).result;
      if (result) Object.assign(out, result);
    } catch {
      // an unreadable payload contributes nothing
    }
  }
  return out;
}

/** Roles that come from uploads and are rebuilt; the others (cover, poster, scene, question audio…) are set elsewhere. */
const REBUILT = ['source', 'smaller', 'page_image', 'audio'];

function blobExists(tx: Tx, sha: string | null | undefined): sha is string {
  return typeof sha === 'string' && tx.get('SELECT 1 FROM blob WHERE sha256 = ?', sha) !== undefined;
}

export function lessonsUsingUpload(tx: Tx, uploadId: string): string[] {
  return tx
    .all<{ id: string }>(
      "SELECT l.id FROM lesson l WHERE EXISTS (SELECT 1 FROM json_each(l.body_json, '$.uploadIds') WHERE value = ?) OR json_extract(l.body_json, '$.readAlongUploadId') = ?",
      uploadId,
      uploadId,
    )
    .map((r) => r.id);
}

export function rebuildLessonMedia(tx: Tx, lessonId: string): void {
  const lesson = tx.get<{ id: string; type: string; status: string; body_json: string; length_seconds: number | null; pages: number | null; source: string }>(
    'SELECT id, type, status, body_json, length_seconds, pages, source FROM lesson WHERE id = ?',
    lessonId,
  );
  if (!lesson) return;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(lesson.body_json) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const uploadIds = Array.isArray(body.uploadIds) ? body.uploadIds.filter((id): id is string => typeof id === 'string') : [];
  const readAlongId = typeof body.readAlongUploadId === 'string' ? body.readAlongUploadId : null;
  if (uploadIds.length === 0 && !readAlongId) return;

  tx.run(`DELETE FROM lesson_asset WHERE lesson_id = ? AND role IN (${REBUILT.map(() => '?').join(',')})`, lessonId, ...REBUILT);
  const counters: Record<string, number> = {};
  const add = (role: string, sha: string, label: string | null = null): void => {
    const ordinal = counters[role] ?? 0;
    counters[role] = ordinal + 1;
    tx.run('INSERT OR IGNORE INTO lesson_asset (lesson_id, role, ordinal, blob_sha256, label) VALUES (?, ?, ?, ?, ?)', lessonId, role, ordinal, sha, label);
  };

  let length = lesson.length_seconds;
  let pages = 0;
  let note: string | null = null;
  uploadIds.forEach((uploadId, index) => {
    const upload = tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', uploadId);
    if (!upload) return;
    const results = uploadResults(tx, uploadId);
    if (upload.state === 'failed') note = upload.processing_note ?? 'The bag could not get this file ready.';
    if (index === 0 && upload.duration_seconds !== null) length = upload.duration_seconds;
    if (upload.kind === 'video') {
      if (blobExists(tx, results.smaller)) add('smaller', results.smaller);
      if (blobExists(tx, upload.blob_sha256)) add('source', upload.blob_sha256);
    } else if (upload.kind === 'audio' || upload.kind === 'voice-note') {
      // The converted copy plays on every phone; the original is kept behind it when it is a format phones know.
      if (blobExists(tx, results.audio)) add('source', results.audio);
      if (blobExists(tx, upload.blob_sha256) && upload.blob_sha256 !== results.audio) add('source', upload.blob_sha256);
    } else if (upload.kind === 'pdf') {
      for (const sha of results.pages ?? []) {
        if (blobExists(tx, sha)) {
          pages += 1;
          add('page_image', sha, `Page ${pages}`);
        }
      }
      if (pages === 0 && upload.pages !== null) pages = upload.pages;
    } else if (upload.kind === 'photo') {
      if (blobExists(tx, upload.blob_sha256)) {
        pages += 1;
        add('page_image', upload.blob_sha256, `Page ${pages}`);
      }
    } else if (upload.kind === 'word') {
      // The text of a .docx becomes Read blocks, once; later edits by the admin are kept.
      if (results.blocks && (!Array.isArray(body.blocks) || body.blocks.length === 0 || body.blocksFromUpload === true)) {
        body.blocks = results.blocks;
        body.blocksFromUpload = true;
      }
    } else if (upload.kind === 'animation' && results.package) {
      body.mode = 'package';
      body.packageUrl = results.package.url;
      tx.run('UPDATE tryit_package SET lesson_id = ? WHERE id = ?', lessonId, results.package.id);
    }
  });

  let readAlong = false;
  if (readAlongId) {
    const upload = tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', readAlongId);
    if (upload) {
      const results = uploadResults(tx, readAlongId);
      const sha = blobExists(tx, results.audio) ? results.audio : blobExists(tx, upload.blob_sha256) ? upload.blob_sha256 : null;
      if (sha) {
        add('audio', sha);
        readAlong = true;
      }
    }
  }

  if (note) body.mediaNote = note;
  else delete body.mediaNote;
  tx.run(
    'UPDATE lesson SET body_json = ?, length_seconds = ?, pages = ?, read_along = CASE WHEN ? = 1 THEN 1 ELSE read_along END, updated_at = ?, seq = ? WHERE id = ?',
    JSON.stringify(body),
    length,
    pages > 0 ? pages : lesson.pages,
    readAlong ? 1 : 0,
    nowIso(),
    tx.seq(),
    lessonId,
  );
  if (lesson.status === 'published') tx.bumpContentRev();
}

/** A ready upload's own stored file (a photo or a sound), for scenes and spot sounds. */
export function readyUploadBlob(tx: Tx, uploadId: string, kinds: string[]): { sha256: string; url: string; mimeType: string } | null {
  const upload = tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', uploadId);
  if (!upload || kinds.indexOf(upload.kind) === -1) return null;
  const sha = uploadResults(tx, uploadId).audio ?? upload.blob_sha256;
  if (!sha) return null;
  const blob = tx.get<{ rel_path: string; mime_type: string }>('SELECT rel_path, mime_type FROM blob WHERE sha256 = ?', sha);
  return blob ? { sha256: sha, url: `/media/${blob.rel_path}`, mimeType: blob.mime_type } : null;
}

/** Does the lesson have something a phone can open? Used by the publish rule. */
export function lessonIsPlayable(tx: Tx, lessonId: string): { ok: boolean; reason: string | null } {
  const lesson = tx.get<{ type: string; body_json: string }>('SELECT type, body_json FROM lesson WHERE id = ?', lessonId);
  if (!lesson) return { ok: false, reason: 'This lesson is not in this bag.' };
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(lesson.body_json) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const count = (roles: string[]): number =>
    Number(tx.value(`SELECT count(*) FROM lesson_asset a JOIN blob b ON b.sha256 = a.blob_sha256 WHERE a.lesson_id = ? AND a.role IN (${roles.map(() => '?').join(',')})`, lessonId, ...roles) ?? 0);
  const has = (key: string): boolean => Array.isArray(body[key]) && (body[key] as unknown[]).length > 0;
  const uploadIds = Array.isArray(body.uploadIds) ? (body.uploadIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  const working =
    uploadIds.length > 0 ? Number(tx.value(`SELECT count(*) FROM upload WHERE state IN ('receiving','processing') AND id IN (${uploadIds.map(() => '?').join(',')})`, ...uploadIds) ?? 0) : 0;
  const notReady = working > 0 ? 'The bag is still getting the file ready. Try again in a moment.' : 'The file of this lesson is missing. Upload it again.';
  if (lesson.type === 'watch') return count(['source', 'smaller']) > 0 || has('sources') ? { ok: true, reason: null } : { ok: false, reason: notReady };
  if (lesson.type === 'listen') return count(['source', 'audio']) > 0 || has('sources') ? { ok: true, reason: null } : { ok: false, reason: notReady };
  if (lesson.type === 'read') {
    return count(['page_image']) > 0 || has('blocks') || has('pageImages') ? { ok: true, reason: null } : { ok: false, reason: working > 0 ? notReady : 'This lesson has nothing to read yet.' };
  }
  if (lesson.type === 'try') {
    if (body.mode === 'hotspots') return has('spots') && body.scene ? { ok: true, reason: null } : { ok: false, reason: 'Add the picture and at least one spot first.' };
    return typeof body.packageUrl === 'string' && body.packageUrl !== '' ? { ok: true, reason: null } : { ok: false, reason: notReady };
  }
  return has('questions') ? { ok: true, reason: null } : { ok: false, reason: 'Add at least one question first.' };
}
