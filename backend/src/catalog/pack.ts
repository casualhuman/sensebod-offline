/*
 * Content packs from a USB stick (SYSTEM-ARCHITECTURE §8.3).
 *
 *   sensebod-offline-pack-<id>-<version>/manifest.json (+ manifest.json.sig)
 *                               /files/<sha256>.<ext>
 *
 * Install: verify the signature (namespace sensebod-offline-content) → check space →
 * copy each file into the media store if it is not there yet (hash verified,
 * temp + fsync + rename) → ONE transaction inserts or updates groups, series,
 * lessons and their files and bumps the content revision. Interrupted before
 * that transaction, nothing changed for learners and "Install again" resumes:
 * files already copied are skipped.
 *
 * manifest.json (format sensebod-offline-pack/1; the pack builder of DEV-5 writes it):
 *   { format, id, version,
 *     files:   [{ sha256, size, ext }],
 *     groups:  [{ id, portalId, kind, title, description?, icon?, audience? }],
 *     series:  [{ id, groupId, title, description?, icon? }],
 *     lessons: [{ id, seriesId, type, title, summary?, language?, lengthSeconds?, pages?, captions?,
 *                 body?, assets: [{ role, sha256, language?, label? }] }] }   // in learner order; a `check` lesson is the quiz
 */
import { existsSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx, Tx } from '../core/context.ts';
import { sha256Hex } from '../core/ids.ts';
import { nowIso } from '../core/time.ts';
import { PACK_DIR, verifySignature } from '../exports/usb.ts';
import { BLOB_EXTS, blobRelPath, existingBlob, hashFile, insertBlob, storeFile, type StoredBlob } from '../media/store.ts';
import { payloadOf, type JobRow } from '../worker/queue.ts';
import { JobFailure, type AfterCommit, type Handler } from '../worker/types.ts';

interface PackManifest {
  format: string;
  id: string;
  version: string;
  files: { sha256: string; size: number; ext: string }[];
  groups?: { id: string; portalId: string; kind: string; title: string; description?: string; icon?: string | null; audience?: string | null }[];
  series?: { id: string; groupId: string; title: string; description?: string; icon?: string | null }[];
  lessons?: {
    id: string;
    seriesId: string;
    type: string;
    title: string;
    summary?: string;
    language?: string;
    lengthSeconds?: number | null;
    pages?: number | null;
    captions?: boolean;
    body?: Record<string, unknown>;
    assets?: { role: string; sha256: string; language?: string | null; label?: string | null }[];
  }[];
}

interface PackResult {
  manifest: PackManifest;
  manifestSha256: string;
  blobs: StoredBlob[];
  copied: number;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TYPES = ['watch', 'listen', 'read', 'try', 'check'];
const ROLES = ['source', 'smaller', 'poster', 'caption', 'audio', 'page_image', 'cover', 'question_audio', 'spot_audio', 'scene'];

/** Shape checks before anything is copied: a signed manifest is still read defensively. */
export function checkManifest(manifest: PackManifest, name: string): void {
  const bad = (what: string): never => {
    throw new JobFailure('bad_pack', `The content pack is not valid: ${what}.`);
  };
  const dir = PACK_DIR.exec(name);
  if (manifest.format !== 'sensebod-offline-pack/1') bad('unknown format');
  if (!dir || manifest.id !== dir[1] || String(manifest.version) !== dir[2]) bad('its name and its manifest disagree');
  const files = new Set<string>();
  for (const file of manifest.files ?? []) {
    if (!/^[0-9a-f]{64}$/.test(file.sha256) || BLOB_EXTS.indexOf(file.ext) === -1 || !Number.isSafeInteger(file.size) || file.size < 0) bad('a file entry');
    files.add(file.sha256);
  }
  for (const group of manifest.groups ?? []) if (!SLUG.test(group.id) || !group.title || ['class', 'audience', 'topic'].indexOf(group.kind) === -1) bad(`group ${String(group.id).slice(0, 40)}`);
  for (const series of manifest.series ?? []) if (!SLUG.test(series.id) || !SLUG.test(series.groupId) || !series.title) bad(`series ${String(series.id).slice(0, 40)}`);
  for (const lesson of manifest.lessons ?? []) {
    if (!SLUG.test(lesson.id) || !SLUG.test(lesson.seriesId) || TYPES.indexOf(lesson.type) === -1 || !lesson.title || lesson.title.length > 120) bad(`lesson ${String(lesson.id).slice(0, 40)}`);
    for (const asset of lesson.assets ?? []) if (ROLES.indexOf(asset.role) === -1 || !files.has(asset.sha256)) bad(`a file of lesson ${lesson.id}`);
  }
}

function install(tx: Tx, result: PackResult, actor: string): { lessons: number; series: number } {
  const { manifest } = result;
  const now = nowIso();
  for (const blob of result.blobs) {
    if (!existingBlob(tx, blob.sha256)) insertBlob(tx, blob);
    else tx.run('UPDATE blob SET unreferenced_since = NULL WHERE sha256 = ?', blob.sha256);
  }
  (manifest.groups ?? []).forEach((group, index) => {
    if (!tx.get('SELECT 1 FROM portal WHERE id = ?', group.portalId)) throw new Error(`Unknown portal ${group.portalId}.`);
    tx.run(
      `INSERT INTO content_group (id, portal_id, kind, title, description, icon, audience, sort_order, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(sort_order), 0) + 1 + ? FROM content_group WHERE portal_id = ?), ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description, icon = excluded.icon, availability = 'available', updated_at = excluded.updated_at, seq = excluded.seq`,
      group.id,
      group.portalId,
      group.kind,
      group.title,
      group.description ?? '',
      group.icon ?? null,
      group.audience ?? null,
      index,
      group.portalId,
      now,
      tx.seq(),
    );
  });
  (manifest.series ?? []).forEach((series, index) => {
    if (!tx.get('SELECT 1 FROM content_group WHERE id = ?', series.groupId)) throw new Error(`Unknown group ${series.groupId}.`);
    tx.run(
      `INSERT INTO series (id, group_id, title, description, icon, sort_order, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, (SELECT coalesce(max(sort_order), 0) + 1 + ? FROM series WHERE group_id = ?), ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description, icon = excluded.icon, availability = 'available', updated_at = excluded.updated_at, seq = excluded.seq`,
      series.id,
      series.groupId,
      series.title,
      series.description ?? '',
      series.icon ?? null,
      index,
      series.groupId,
      now,
      tx.seq(),
    );
  });
  const touched = new Set<string>();
  let parkedAt = -2_000_000;
  for (const lesson of manifest.lessons ?? []) {
    if (!tx.get('SELECT 1 FROM series WHERE id = ?', lesson.seriesId)) throw new Error(`Unknown series ${lesson.seriesId}.`);
    const owner = tx.get<{ source: string }>('SELECT source FROM lesson WHERE id = ?', lesson.id);
    if (owner && owner.source !== 'content-pack') throw new Error(`Lesson ${lesson.id} already exists and is not from a pack.`);
    touched.add(lesson.seriesId);
    const quiz = lesson.type === 'check';
    // Parked on a negative position of its own; the final order is written below.
    parkedAt -= 1;
    const parked = quiz ? null : parkedAt;
    tx.run(
      `INSERT INTO lesson (id, series_id, position, type, interactive, captions, read_along, needs_sound, length_seconds, pages, title, summary, language, status, source,
                           file_names_json, body_json, version, created_at, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'published', 'content-pack', '[]', ?, 1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET series_id = excluded.series_id, position = excluded.position, type = excluded.type, captions = excluded.captions, length_seconds = excluded.length_seconds,
         pages = excluded.pages, title = excluded.title, summary = excluded.summary, language = excluded.language, body_json = excluded.body_json,
         version = lesson.version + 1, updated_at = excluded.updated_at, seq = excluded.seq`,
      lesson.id,
      lesson.seriesId,
      parked,
      lesson.type,
      lesson.type === 'try' ? 1 : 0,
      lesson.captions ? 1 : 0,
      lesson.type === 'watch' || lesson.type === 'listen' ? 1 : 0,
      lesson.lengthSeconds ?? null,
      lesson.pages ?? null,
      lesson.title,
      lesson.summary ?? '',
      lesson.language ?? 'en',
      JSON.stringify(lesson.body ?? {}),
      now,
      now,
      tx.seq(),
    );
    tx.run('DELETE FROM lesson_asset WHERE lesson_id = ?', lesson.id);
    const ordinals: Record<string, number> = {};
    for (const asset of lesson.assets ?? []) {
      const ordinal = ordinals[asset.role] ?? 0;
      ordinals[asset.role] = ordinal + 1;
      tx.run('INSERT INTO lesson_asset (lesson_id, role, ordinal, blob_sha256, language, label) VALUES (?, ?, ?, ?, ?, ?)', lesson.id, asset.role, ordinal, asset.sha256, asset.language ?? null, asset.label ?? null);
    }
  }
  // Order of each touched series: the pack's lessons in manifest order, then whatever admins had added, 1..n.
  for (const seriesId of touched) {
    const packIds = (manifest.lessons ?? []).filter((l) => l.seriesId === seriesId && l.type !== 'check').map((l) => l.id);
    const others = tx.all<{ id: string }>('SELECT id FROM lesson WHERE series_id = ? AND position IS NOT NULL AND position > 0 ORDER BY position', seriesId).map((r) => r.id);
    tx.run('UPDATE lesson SET position = -position WHERE series_id = ? AND position > 0', seriesId);
    [...packIds, ...others.filter((id) => packIds.indexOf(id) === -1)].forEach((id, index) => tx.run('UPDATE lesson SET position = ? WHERE id = ?', index + 1, id));
    const check = tx.get<{ lo: number | null; hi: number | null; n: number }>('SELECT min(position) AS lo, max(position) AS hi, count(*) AS n FROM lesson WHERE series_id = ? AND position IS NOT NULL', seriesId);
    if (check && check.n > 0 && (check.lo !== 1 || check.hi !== check.n)) throw new Error('Renumbering left the series out of order.');
  }
  tx.run(
    `INSERT INTO content_pack (id, version, manifest_sha256, state, copied_files, total_files, installed_at, updated_at) VALUES (?, ?, ?, 'installed', ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET version = excluded.version, manifest_sha256 = excluded.manifest_sha256, state = 'installed', copied_files = excluded.copied_files,
       total_files = excluded.total_files, installed_at = excluded.installed_at, updated_at = excluded.updated_at`,
    manifest.id,
    String(manifest.version),
    result.manifestSha256,
    manifest.files.length,
    manifest.files.length,
    now,
    now,
  );
  tx.bumpContentRev();
  tx.audit({ actorId: actor, actorName: actor, action: 'content_pack.install', targetType: 'content_pack', targetId: manifest.id, detail: { version: manifest.version, files: manifest.files.length, copied: result.copied, lessons: (manifest.lessons ?? []).length } });
  return { lessons: (manifest.lessons ?? []).length, series: touched.size };
}

export const contentPackInstall: Handler = {
  lane: 'usb',
  async run(env): Promise<PackResult> {
    const name = String(env.job.payload.name ?? '');
    if (!PACK_DIR.test(name)) throw new JobFailure('bad_pack', 'This is not a content pack.');
    const dir = join(env.paths.usbMount, name);
    const manifestFile = join(dir, 'manifest.json');
    if (!existsSync(manifestFile)) throw new JobFailure('usb_removed', 'The stick was taken out too early.');
    // Verified again here, whatever the screen showed: only EasySTEM's content key in allowed_signers is accepted.
    if (!(await verifySignature(env, manifestFile, `${manifestFile}.sig`, 'sensebod-offline-content', 'content@easystem'))) throw new JobFailure('bad_signature', 'This package is not signed by EasySTEM.');
    const text = readFileSync(manifestFile, 'utf8');
    const manifest = JSON.parse(text) as PackManifest;
    checkManifest(manifest, name);
    const present = (file: { sha256: string; size: number; ext: string }): boolean => {
      try {
        return statSync(join(env.paths.media, blobRelPath(file.sha256, file.ext, 'content-pack'))).size === file.size;
      } catch {
        return false;
      }
    };
    const missing = manifest.files.filter((file) => !present(file));
    const needed = missing.reduce((sum, file) => sum + file.size, 0);
    const space = statfsSync(env.paths.data);
    if (Number(space.bavail) * Number(space.bsize) - env.config.limits.reserveBytes < needed) throw new JobFailure('no_space', 'Not enough space on the bag for this content pack.');
    const blobs: StoredBlob[] = [];
    let done = 0;
    let copied = 0;
    for (const file of manifest.files) {
      const source = join(dir, 'files', `${file.sha256}.${file.ext}`);
      if (present(file)) {
        // Already copied (an earlier, interrupted install): the store's file is taken as it is.
        blobs.push(await storeFile(env.paths, join(env.paths.media, blobRelPath(file.sha256, file.ext, 'content-pack')), file.sha256, file.size, file.ext, 'content-pack', false));
      } else {
        let hashed: { sha256: string; sizeBytes: number };
        try {
          hashed = await hashFile(source);
        } catch {
          throw new JobFailure('usb_removed', 'The stick was taken out too early.');
        }
        if (hashed.sha256 !== file.sha256 || hashed.sizeBytes !== file.size) throw new JobFailure('bad_pack', 'A file of the content pack is damaged.');
        blobs.push(await storeFile(env.paths, source, file.sha256, file.size, file.ext, 'content-pack', false));
        copied += 1;
      }
      done += 1;
      env.progress(Math.round((done / Math.max(1, manifest.files.length)) * 95));
    }
    return { manifest, manifestSha256: sha256Hex(text), blobs, copied };
  },
  finalize(_ctx: Ctx, tx: Tx, _job: JobRow, raw: unknown): AfterCommit {
    install(tx, raw as PackResult, 'system');
    return undefined;
  },
  failed(_ctx, tx, job, state, code) {
    tx.audit({ actorId: 'system', actorName: 'system', action: 'content_pack.install', outcome: state, detail: { name: payloadOf<{ name: string }>(job).name, errorCode: code } });
    return undefined;
  },
};

export { install as installPackInTx };
