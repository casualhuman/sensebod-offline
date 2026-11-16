/*
 * catalog routes: learner content (cacheable, ETag from the content revision)
 * and admin content (library, lessons, placement and renumbering, publish
 * rules, questions, Try it, series and order, the picture gallery).
 *
 * Placement and ordering follow DATABASE §6.2: one BEGIN IMMEDIATE
 * transaction, a negative pass so the unique (series, position) index never
 * sees a duplicate, and an assertion that the numbered lessons are exactly
 * 1..n before COMMIT.
 */
import { Router, type Request } from 'express';
import type { Ctx, Tx } from '../core/context.ts';
import { ApiError, asObject, conflict, invalid, notFound } from '../core/errors.ts';
import { contentRoute, paging, pathParam, queryString, sendJson, sendNoContent, type AdminIdentity } from '../core/http.ts';
import { actorScope, idempotent } from '../core/idempotency.ts';
import { newId } from '../core/ids.ts';
import { setSensitiveLessonIds } from '../core/log.ts';
import { nowIso } from '../core/time.ts';
import { requireAdmin } from '../identity/sessions.ts';
import { lessonIsPlayable, readyUploadBlob, rebuildLessonMedia, type UploadRow } from '../media/attach.ts';
import {
  ADMIN_FROM,
  ADMIN_ORDER,
  adminLesson,
  adminLessonsWhere,
  adminSeries,
  groupDetail,
  lessonDetail,
  listPortals,
  parseBody,
  portalDetail,
  sensitiveLessonIds,
  seriesDetail,
  seriesIsSensitive,
  type LessonType,
} from './model.ts';
import { cleanBlocks, cleanQuestions, cleanSpots, cleanTranscript, pictureIn } from './validate.ts';

const TYPES: LessonType[] = ['watch', 'listen', 'read', 'try', 'check'];
const PORTALS = ['primary', 'jss', 'child-protection', 'agriculture', 'climate'];

interface PlainLesson {
  id: string;
  series_id: string | null;
  position: number | null;
  type: LessonType;
  status: 'draft' | 'published';
  source: string;
  version: number;
  body_json: string;
  interactive: number;
}

function loadLesson(tx: Tx, id: string): PlainLesson {
  const row = tx.get<PlainLesson>('SELECT id, series_id, position, type, status, source, version, body_json, interactive FROM lesson WHERE id = ?', id);
  if (!row) throw notFound('This lesson');
  return row;
}

/** Write the numbered lessons of a series as 1..n in the given order (DATABASE §6.2 steps 3–4). */
function applyOrder(tx: Tx, seriesId: string, orderedIds: string[]): void {
  const before = new Map(tx.all<{ id: string; position: number }>('SELECT id, position FROM lesson WHERE series_id = ? AND position IS NOT NULL', seriesId).map((r) => [r.id, r.position]));
  // Negative pass: SQLite checks UNIQUE per statement and has no deferrable unique constraints.
  tx.run('UPDATE lesson SET position = -position WHERE series_id = ? AND position IS NOT NULL AND position > 0', seriesId);
  const now = nowIso();
  orderedIds.forEach((id, index) => {
    const position = index + 1;
    if (before.get(id) === position) tx.run('UPDATE lesson SET position = ? WHERE id = ?', position, id);
    else tx.run('UPDATE lesson SET position = ?, version = version + 1, updated_at = ?, seq = ? WHERE id = ?', position, now, tx.seq(), id);
  });
  const check = tx.get<{ lo: number | null; hi: number | null; n: number }>('SELECT min(position) AS lo, max(position) AS hi, count(*) AS n FROM lesson WHERE series_id = ? AND position IS NOT NULL', seriesId);
  const n = orderedIds.length;
  if (!check || check.n !== n || (n > 0 && (check.lo !== 1 || check.hi !== n))) throw new Error('Renumbering left the series out of order.');
}

function numberedIds(tx: Tx, seriesId: string, exceptId: string | null = null): string[] {
  return tx
    .all<{ id: string }>('SELECT id FROM lesson WHERE series_id = ? AND position IS NOT NULL ORDER BY position', seriesId)
    .map((r) => r.id)
    .filter((id) => id !== exceptId);
}

/** Saved progress on a lesson is removed, with tombstones, when it enters a sensitive portal (DATABASE §6.5). */
function removeProgressOf(tx: Tx, lessonId: string): number {
  const rows = tx.all<{ learner_id: string }>('SELECT learner_id FROM lesson_progress WHERE lesson_id = ?', lessonId);
  const now = nowIso();
  for (const row of rows) {
    tx.run(
      "INSERT INTO tombstone (entity, entity_id, seq, deleted_at) VALUES ('lesson_progress', ?, ?, ?) ON CONFLICT (entity, entity_id) DO UPDATE SET seq = excluded.seq, deleted_at = excluded.deleted_at",
      `${row.learner_id}|${lessonId}`,
      tx.seq(),
      now,
    );
  }
  tx.run('DELETE FROM lesson_progress WHERE lesson_id = ?', lessonId);
  return rows.length;
}

interface PlacementInput {
  portalId: string;
  groupId: string;
  seriesId: string;
  position: number;
}

function readPlacement(value: unknown): PlacementInput | null {
  if (value === null) return null;
  const v = asObject(value);
  if (typeof v.portalId !== 'string' || typeof v.groupId !== 'string' || typeof v.seriesId !== 'string') throw invalid('Choose where the lesson goes.', { placement: 'Choose the series again.' });
  const position = typeof v.position === 'number' && Number.isFinite(v.position) ? Math.floor(v.position) : 1;
  return { portalId: v.portalId, groupId: v.groupId, seriesId: v.seriesId, position: Math.max(1, position) };
}

/** Insert the lesson at a position (or take it out), renumbering both series involved. */
function place(ctx: Ctx, tx: Tx, lesson: PlainLesson, placement: PlacementInput | null): void {
  const oldSeries = lesson.series_id;
  const now = nowIso();
  if (placement === null) {
    if (oldSeries === null) return;
    // Published implies placed: taking a lesson out makes it a draft again.
    tx.run("UPDATE lesson SET series_id = NULL, position = NULL, status = 'draft', version = version + 1, updated_at = ?, seq = ? WHERE id = ?", now, tx.seq(), lesson.id);
    applyOrder(tx, oldSeries, numberedIds(tx, oldSeries));
    tx.bumpContentRev();
    return;
  }
  const series = tx.get<{ id: string; group_id: string; portal_id: string }>(
    'SELECT s.id, s.group_id, g.portal_id FROM series s JOIN content_group g ON g.id = s.group_id WHERE s.id = ?',
    placement.seriesId,
  );
  if (!series) throw notFound('This series');
  if (series.group_id !== placement.groupId || series.portal_id !== placement.portalId) throw invalid('That series is not in the chosen portal and group.', { placement: 'Choose the series again.' });

  if (lesson.type === 'check') {
    const other = tx.get<{ id: string }>("SELECT id FROM lesson WHERE series_id = ? AND type = 'check' AND id <> ?", series.id, lesson.id);
    if (other) throw conflict('conflict', 'This series already has a quiz. Open that quiz to change it.');
    tx.run('UPDATE lesson SET series_id = ?, position = NULL, version = version + 1, updated_at = ?, seq = ? WHERE id = ?', series.id, now, tx.seq(), lesson.id);
  } else {
    const others = numberedIds(tx, series.id, lesson.id);
    const index = Math.min(others.length, placement.position - 1);
    others.splice(index, 0, lesson.id);
    // Park the lesson on a negative position of its own while the others move.
    tx.run('UPDATE lesson SET series_id = ?, position = ?, version = version + 1, updated_at = ?, seq = ? WHERE id = ?', series.id, -1_000_000 - others.length, now, tx.seq(), lesson.id);
    applyOrder(tx, series.id, others);
  }
  if (oldSeries !== null && oldSeries !== series.id) applyOrder(tx, oldSeries, numberedIds(tx, oldSeries));
  if (ctx.countsOnly() && seriesIsSensitive(tx.db, series.id)) removeProgressOf(tx, lesson.id);
  tx.bumpContentRev();
}

function refreshSensitive(ctx: Ctx): void {
  setSensitiveLessonIds(sensitiveLessonIds(ctx.db));
}

function ifMatch(req: Request): number | null {
  const header = req.headers['if-match'];
  if (typeof header !== 'string') return null;
  const match = /^(?:W\/)?"v(\d+)"$/.exec(header.trim());
  if (!match) throw new ApiError(412, 'precondition_failed', 'Someone else changed this lesson. Look at it again.');
  return Number(match[1]);
}

export function catalogRoutes(ctx: Ctx): Router {
  const router = Router();
  const admin = requireAdmin(ctx);
  refreshSensitive(ctx);

  /* ---------------- learner content ---------------- */
  router.get(
    '/portals',
    contentRoute(ctx, () => listPortals(ctx.db)),
  );
  router.get(
    '/portals/:portalId',
    contentRoute(ctx, (req) => portalDetail(ctx.db, pathParam(req, 'portalId'))),
  );
  router.get(
    '/groups/:groupId',
    contentRoute(ctx, (req) => groupDetail(ctx.db, pathParam(req, 'groupId'))),
  );
  router.get(
    '/series/:seriesId',
    contentRoute(ctx, (req) => seriesDetail(ctx.db, pathParam(req, 'seriesId'))),
  );
  router.get(
    '/lessons/:lessonId',
    contentRoute(ctx, (req) => lessonDetail(ctx.db, pathParam(req, 'lessonId'))),
  );

  /* ---------------- admin: library ---------------- */
  router.get('/admin/lessons', admin, (req, res) => {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const filter = (name: string, column: string, allowed?: string[]): void => {
      const value = queryString(req, name);
      if (value === null) return;
      if (allowed && allowed.indexOf(value) === -1) throw invalid('That filter is not known.', { [name]: 'Choose again.' });
      where.push(`${column} = ?`);
      params.push(value);
    };
    if (queryString(req, 'unplaced') === 'true') {
      where.push('l.series_id IS NULL');
    } else {
      filter('portalId', 'p.id', PORTALS);
      filter('groupId', 'g.id');
      filter('seriesId', 'l.series_id');
      filter('type', 'l.type', TYPES);
      filter('status', 'l.status', ['draft', 'published']);
      const search = (queryString(req, 'search') ?? '').trim().slice(0, 100);
      if (search) {
        const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(
          "(l.title LIKE ? ESCAPE '\\' OR l.file_names_json LIKE ? ESCAPE '\\' OR coalesce(p.title, '') LIKE ? ESCAPE '\\' OR coalesce(g.title, '') LIKE ? ESCAPE '\\' OR coalesce(s.title, '') LIKE ? ESCAPE '\\')",
        );
        params.push(like, like, like, like, like);
      }
    }
    const clause = where.length > 0 ? where.join(' AND ') : '1 = 1';
    const totals = ctx.db.get<{ total: number; published: number | null }>(`SELECT count(*) AS total, sum(l.status = 'published') AS published ${ADMIN_FROM} WHERE ${clause}`, ...params) ?? { total: 0, published: 0 };
    const { page, pageSize, offset } = paging(req);
    sendJson(res, 200, {
      items: adminLessonsWhere(ctx.db, clause, [...params, pageSize, offset], `${ADMIN_ORDER} LIMIT ? OFFSET ?`),
      page,
      pageSize,
      total: totals.total,
      publishedCount: totals.published ?? 0,
      draftCount: totals.total - (totals.published ?? 0),
    });
  });

  router.get('/admin/portals', admin, (_req, res) => {
    sendJson(
      res,
      200,
      ctx.db
        .all<{ id: string; title: string; description: string; n: number }>(
          `SELECT p.id, p.title, p.description,
                  (SELECT count(*) FROM lesson l JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id WHERE g.portal_id = p.id AND l.type <> 'check') AS n
             FROM portal p ORDER BY p.sort_order`,
        )
        .map((r) => ({ portalId: r.id, title: r.title, description: r.description, lessonCount: r.n })),
    );
  });

  router.get('/admin/lessons/:lessonId', admin, (req, res) => {
    const lesson = adminLesson(ctx.db, pathParam(req, 'lessonId'));
    res.setHeader('ETag', `"v${lesson.version}"`);
    sendJson(res, 200, lesson);
  });

  /* ---------------- admin: create a draft ---------------- */
  router.post('/admin/lessons', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const input = asObject(req.sb.body);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw invalid('Give the lesson a title learners will see.', { title: 'Type a title.' });
    if (title.length > 120) throw invalid('That title is too long.', { title: 'Use up to 120 letters.' });
    const source = input.source;
    const uploadIds = Array.isArray(input.uploadIds) ? input.uploadIds.filter((id): id is string => typeof id === 'string').slice(0, 60) : [];
    const blocks = input.blocks === undefined ? [] : cleanBlocks(input.blocks);
    const readAlongId = typeof input.readAlongUploadId === 'string' ? input.readAlongUploadId : null;

    const outcome = await idempotent(ctx, req, { scope: actorScope(req), required: true }, (tx) => {
      const uploads = uploadIds.map((id) => {
        const upload = tx.get<UploadRow>("SELECT * FROM upload WHERE id = ? AND state IN ('processing','ready')", id);
        if (!upload) throw invalid('One of the files is no longer on this bag. Upload it again.', { uploadIds: id });
        return upload;
      });
      let type: LessonType = 'read';
      if (source === 'upload' || source === 'animation') {
        if (uploads.length !== 1) throw invalid('Choose one file for this lesson.', { uploadIds: 'One file is needed.' });
        const becomes = (uploads[0] as UploadRow).becomes;
        type = TYPES.indexOf(becomes as LessonType) === -1 ? 'read' : (becomes as LessonType);
      } else if (source === 'notes-photos') {
        if (uploads.length === 0) throw invalid('Add at least one photo of your notes.', { uploadIds: 'Add a photo.' });
        if (uploads.some((u) => u.kind !== 'photo')) throw invalid('Notes must be photos.', { uploadIds: 'Use photos only.' });
      } else if (source === 'typed') {
        if (blocks.length === 0) throw invalid('Write the lesson text first.', { blocks: 'The lesson is empty.' });
      } else if (source === 'questions') {
        type = 'check';
      } else {
        throw invalid('Say where the content comes from.', { source: 'Unknown source.' });
      }
      if (readAlongId && !tx.get("SELECT 1 FROM upload WHERE id = ? AND state IN ('processing','ready') AND kind IN ('audio','voice-note')", readAlongId)) {
        throw invalid('The recording is no longer on this bag. Record it again.', { readAlongUploadId: readAlongId });
      }
      const body: Record<string, unknown> = {};
      if (uploads.length > 0) body.uploadIds = uploads.map((u) => u.id);
      if (readAlongId) body.readAlongUploadId = readAlongId;
      if (type === 'read') body.blocks = blocks;
      if (type === 'watch') Object.assign(body, { questions: [], learningPoints: [] });
      if (type === 'listen') body.transcript = [];
      if (type === 'check') body.questions = [];
      if (type === 'try') Object.assign(body, { mode: 'package', packageUrl: '' });
      const id = newId('ls');
      const now = nowIso();
      const first = uploads[0];
      tx.run(
        `INSERT INTO lesson (id, series_id, position, type, interactive, captions, read_along, needs_sound, length_seconds, pages, title, summary, language, status, source,
                             picture_id, file_names_json, body_json, version, created_by, created_at, updated_at, seq)
         VALUES (?, NULL, NULL, ?, ?, 0, 0, ?, ?, ?, ?, '', 'en', 'draft', ?, NULL, ?, ?, 1, ?, ?, ?, ?)`,
        id,
        type,
        type === 'try' ? 1 : 0,
        type === 'watch' || type === 'listen' ? 1 : 0,
        first ? first.duration_seconds : null,
        source === 'notes-photos' ? uploads.length : first ? first.pages : null,
        title,
        source as string,
        JSON.stringify(uploads.map((u) => u.file_name)),
        JSON.stringify(body),
        who.id,
        now,
        now,
        tx.seq(),
      );
      rebuildLessonMedia(tx, id);
      tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.create', targetType: 'lesson', targetId: id, detail: { source, type }, clientIp: req.sb.ip });
      return { status: 201, body: adminLesson(tx.db, id) };
    });
    sendJson(res, outcome.status, outcome.body);
  });

  /* ---------------- admin: change a lesson ---------------- */
  router.patch('/admin/lessons/:lessonId', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'lessonId');
    const patch = asObject(req.sb.body);
    const expected = ifMatch(req);
    const fields: Record<string, string> = {};
    const title = patch.title === undefined ? undefined : typeof patch.title === 'string' ? patch.title.trim() : '';
    if (title !== undefined && (title.length < 1 || title.length > 120)) fields.title = title ? 'Use up to 120 letters.' : 'Type a title.';
    if (patch.summary !== undefined && (typeof patch.summary !== 'string' || patch.summary.length > 2000)) fields.summary = 'Use a shorter summary.';
    if (patch.type !== undefined && TYPES.indexOf(patch.type as LessonType) === -1) fields.type = 'Choose Watch, Listen, Read, Try it or Check.';
    if (patch.interactive !== undefined && typeof patch.interactive !== 'boolean') fields.interactive = 'Choose yes or no.';
    if (patch.pictureId !== undefined && patch.pictureId !== null && typeof patch.pictureId !== 'string') fields.pictureId = 'Choose another picture.';
    if (Object.keys(fields).length > 0) throw invalid(fields.title === 'Type a title.' ? 'Give the lesson a title learners will see.' : 'Some details are not right.', fields);
    const blocks = patch.blocks === undefined ? undefined : cleanBlocks(patch.blocks);
    const transcript = patch.transcript === undefined ? undefined : cleanTranscript(patch.transcript);
    const placement = patch.placement === undefined ? undefined : readPlacement(patch.placement);
    // Entering a sensitive portal deletes saved progress; that transaction overwrites the freed pages (V-013).
    const secureDelete = placement !== undefined && placement !== null && ctx.countsOnly() && seriesIsSensitive(ctx.db, placement.seriesId);

    const body = await ctx.write(
      (tx) => {
        const lesson = loadLesson(tx, id);
        if (expected !== null && expected !== lesson.version) throw new ApiError(412, 'precondition_failed', 'Someone else changed this lesson. Look at it again.');
        if (lesson.source === 'content-pack' && Object.keys(patch).some((key) => key !== 'placement' && key !== 'pictureId')) {
          throw conflict('pack_owned', 'This lesson came from EasySTEM. Only its place and picture can be changed here.');
        }
        const content = parseBody(lesson);
        let type = lesson.type;
        if (patch.type !== undefined && patch.type !== lesson.type) {
          if (patch.type === 'check' || lesson.type === 'check') throw invalid('A quiz cannot become another kind of lesson.', { type: 'Make a new lesson instead.' });
          type = patch.type as LessonType;
        }
        if (blocks !== undefined) {
          if (type !== 'read') throw conflict('wrong_type', 'Only Read lessons have text.');
          content.blocks = blocks;
          delete content.blocksFromUpload;
        }
        if (transcript !== undefined) {
          if (type !== 'listen') throw conflict('wrong_type', 'Only Listen lessons have read along text.');
          content.transcript = transcript;
        }
        if (patch.pictureId !== undefined && patch.pictureId !== null && !tx.get('SELECT 1 FROM picture WHERE id = ?', patch.pictureId as string)) {
          throw invalid('That picture is not in the gallery.', { pictureId: 'Choose another picture.' });
        }
        const sets: string[] = ['type = ?', 'body_json = ?', 'version = version + 1', 'updated_at = ?', 'seq = ?'];
        const values: (string | number | null)[] = [type, JSON.stringify(content), nowIso(), tx.seq()];
        if (title !== undefined) {
          sets.push('title = ?');
          values.push(title);
        }
        if (typeof patch.summary === 'string') {
          sets.push('summary = ?');
          values.push(patch.summary);
        }
        if (typeof patch.interactive === 'boolean') {
          sets.push('interactive = ?');
          values.push(patch.interactive ? 1 : 0);
        }
        if (patch.pictureId !== undefined) {
          sets.push('picture_id = ?');
          values.push(patch.pictureId as string | null);
        }
        if (transcript !== undefined) {
          sets.push('read_along = ?');
          values.push(transcript.length > 0 ? 1 : 0);
        }
        tx.run(`UPDATE lesson SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
        if (placement !== undefined) place(ctx, tx, lesson, placement);
        if (lesson.status === 'published') tx.bumpContentRev();
        tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.update', targetType: 'lesson', targetId: id, detail: { fields: Object.keys(patch) }, clientIp: req.sb.ip });
        return adminLesson(tx.db, id);
      },
      { secureDelete },
    );
    if (placement !== undefined) refreshSensitive(ctx);
    res.setHeader('ETag', `"v${body.version}"`);
    sendJson(res, 200, body);
  });

  router.delete('/admin/lessons/:lessonId', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'lessonId');
    await ctx.write((tx) => {
      const lesson = tx.get<PlainLesson>('SELECT id, series_id, position, type, status, source, version, body_json, interactive FROM lesson WHERE id = ?', id);
      // Idempotent: deleting what is already gone is not an error.
      if (!lesson) return;
      tx.run('UPDATE tryit_package SET lesson_id = NULL WHERE lesson_id = ?', id);
      // Progress and file rows go with the lesson (ON DELETE CASCADE); the files themselves are collected after 24 h unreferenced.
      tx.run('DELETE FROM lesson WHERE id = ?', id);
      tx.run(
        "INSERT INTO tombstone (entity, entity_id, seq, deleted_at) VALUES ('lesson', ?, ?, ?) ON CONFLICT (entity, entity_id) DO UPDATE SET seq = excluded.seq, deleted_at = excluded.deleted_at",
        id,
        tx.seq(),
        nowIso(),
      );
      if (lesson.series_id !== null && lesson.position !== null) applyOrder(tx, lesson.series_id, numberedIds(tx, lesson.series_id));
      tx.bumpContentRev();
      tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.delete', targetType: 'lesson', targetId: id, clientIp: req.sb.ip });
    });
    refreshSensitive(ctx);
    sendNoContent(res);
  });

  /* ---------------- admin: publish ---------------- */
  router.post('/admin/lessons/:lessonId/publish', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'lessonId');
    const body = await ctx.write((tx) => {
      const lesson = loadLesson(tx, id);
      if (lesson.status !== 'published') {
        if (lesson.series_id === null) throw conflict('not_placed', 'Choose where this lesson goes before you publish it.');
        const playable = lessonIsPlayable(tx, id);
        if (!playable.ok) throw conflict('conflict', playable.reason ?? 'This lesson is not ready yet.');
        tx.run("UPDATE lesson SET status = 'published', version = version + 1, updated_at = ?, seq = ? WHERE id = ?", nowIso(), tx.seq(), id);
        tx.bumpContentRev();
        tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.publish', targetType: 'lesson', targetId: id, clientIp: req.sb.ip });
      }
      return adminLesson(tx.db, id);
    });
    sendJson(res, 200, body);
  });

  router.post('/admin/lessons/:lessonId/unpublish', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'lessonId');
    const body = await ctx.write((tx) => {
      const lesson = loadLesson(tx, id);
      if (lesson.status === 'published') {
        tx.run("UPDATE lesson SET status = 'draft', version = version + 1, updated_at = ?, seq = ? WHERE id = ?", nowIso(), tx.seq(), id);
        tx.bumpContentRev();
        tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.unpublish', targetType: 'lesson', targetId: id, clientIp: req.sb.ip });
      }
      return adminLesson(tx.db, id);
    });
    sendJson(res, 200, body);
  });

  /* ---------------- admin: questions ---------------- */
  const questionSet = (lesson: PlainLesson) => {
    if (lesson.type !== 'watch' && lesson.type !== 'check') throw conflict('wrong_type', 'Only Watch and Check lessons have questions.');
    const questions = parseBody(lesson).questions;
    return { lessonId: lesson.id, kind: lesson.type === 'watch' ? 'video' : 'check', questions: Array.isArray(questions) ? questions : [] };
  };

  router.get('/admin/lessons/:lessonId/questions', admin, (req, res) => {
    const lesson = ctx.db.get<PlainLesson>('SELECT id, series_id, position, type, status, source, version, body_json, interactive FROM lesson WHERE id = ?', pathParam(req, 'lessonId'));
    if (!lesson) throw notFound('This lesson');
    sendJson(res, 200, questionSet(lesson));
  });

  router.put('/admin/lessons/:lessonId/questions', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'lessonId');
    const input = asObject(req.sb.body);
    const body = await ctx.write((tx) => {
      const lesson = loadLesson(tx, id);
      if (lesson.type !== 'watch' && lesson.type !== 'check') throw conflict('wrong_type', 'Only Watch and Check lessons have questions.');
      if (lesson.source === 'content-pack') throw conflict('pack_owned', 'This lesson came from EasySTEM. Its questions cannot be changed here.');
      const questions = cleanQuestions(input.questions ?? [], lesson.type === 'watch');
      const content = parseBody(lesson);
      content.questions = questions;
      // Sounds of questions are tracked as files of the lesson, so backups and garbage collection see them.
      tx.run("DELETE FROM lesson_asset WHERE lesson_id = ? AND role = 'question_audio'", id);
      questions.forEach((question, index) => {
        const rel = question.listenUrl && question.listenUrl.startsWith('/media/') ? question.listenUrl.slice('/media/'.length) : null;
        const blob = rel ? tx.get<{ sha256: string }>('SELECT sha256 FROM blob WHERE rel_path = ?', rel) : undefined;
        if (blob) tx.run("INSERT OR IGNORE INTO lesson_asset (lesson_id, role, ordinal, blob_sha256, label) VALUES (?, 'question_audio', ?, ?, ?)", id, index, blob.sha256, question.id);
      });
      tx.run(
        'UPDATE lesson SET body_json = ?, interactive = ?, version = version + 1, updated_at = ?, seq = ? WHERE id = ?',
        JSON.stringify(content),
        lesson.type === 'watch' ? (questions.length > 0 ? 1 : 0) : lesson.interactive,
        nowIso(),
        tx.seq(),
        id,
      );
      if (lesson.status === 'published') tx.bumpContentRev();
      tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.questions', targetType: 'lesson', targetId: id, detail: { count: questions.length }, clientIp: req.sb.ip });
      return { lessonId: id, kind: lesson.type === 'watch' ? 'video' : 'check', questions };
    });
    sendJson(res, 200, body);
  });

  /* ---------------- admin: Try it ---------------- */
  const tryItSetup = (tx: { get: Tx['get'] }, lesson: PlainLesson) => {
    if (lesson.type !== 'try') throw conflict('wrong_type', 'This is not a Try it lesson.');
    const content = parseBody(lesson);
    if (content.mode === 'hotspots') {
      return {
        lessonId: lesson.id,
        mode: 'hotspots',
        instruction: content.instruction ?? '',
        scene: content.scene ?? null,
        spots: Array.isArray(content.spots) ? content.spots : [],
        goal: content.goal === 'any' ? 'any' : 'all',
        finishMessage: content.finishMessage ?? '',
        gentleMovement: content.gentleMovement === true,
      };
    }
    const uploadIds = Array.isArray(content.uploadIds) ? content.uploadIds : [];
    const pack = tx.get<{ checks_json: string }>('SELECT checks_json FROM tryit_package WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1', lesson.id);
    let checks: unknown[] = [];
    try {
      checks = pack ? (JSON.parse(pack.checks_json) as unknown[]) : [];
    } catch {
      checks = [];
    }
    return { lessonId: lesson.id, mode: 'package', uploadId: typeof uploadIds[0] === 'string' ? uploadIds[0] : null, packageUrl: typeof content.packageUrl === 'string' && content.packageUrl ? content.packageUrl : null, checks };
  };

  router.get('/admin/lessons/:lessonId/try-it', admin, (req, res) => {
    const lesson = ctx.db.get<PlainLesson>('SELECT id, series_id, position, type, status, source, version, body_json, interactive FROM lesson WHERE id = ?', pathParam(req, 'lessonId'));
    if (!lesson) throw notFound('This lesson');
    sendJson(res, 200, tryItSetup(ctx.db, lesson));
  });

  router.put('/admin/lessons/:lessonId/try-it', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const id = pathParam(req, 'lessonId');
    const setup = asObject(req.sb.body);
    const body = await ctx.write((tx) => {
      const lesson = loadLesson(tx, id);
      if (lesson.type !== 'try') throw conflict('wrong_type', 'This is not a Try it lesson.');
      if (lesson.source === 'content-pack') throw conflict('pack_owned', 'This lesson came from EasySTEM. It cannot be changed here.');
      const content = parseBody(lesson);
      if (setup.mode === 'package') {
        const uploadId = typeof setup.uploadId === 'string' ? setup.uploadId : null;
        if (uploadId) {
          if (!tx.get("SELECT 1 FROM upload WHERE id = ? AND kind = 'animation' AND state IN ('processing','ready')", uploadId)) {
            throw invalid('That animation is no longer on this bag. Upload it again.', { uploadId: 'Upload the animation again.' });
          }
          content.uploadIds = [uploadId];
          content.packageUrl = '';
        }
        content.mode = 'package';
        for (const key of ['instruction', 'scene', 'spots', 'goal', 'finishMessage', 'gentleMovement']) delete content[key];
        tx.run("DELETE FROM lesson_asset WHERE lesson_id = ? AND role IN ('scene','spot_audio')", id);
      } else if (setup.mode === 'hotspots') {
        tx.run("DELETE FROM lesson_asset WHERE lesson_id = ? AND role IN ('scene','spot_audio')", id);
        // Files are tracked from what the lesson shows, whether they arrive as a new upload or as the URL saved before.
        const track = (role: string, ordinal: number, url: string | null | undefined, label: string | null): void => {
          if (!url || !url.startsWith('/media/')) return;
          const blob = tx.get<{ sha256: string }>('SELECT sha256 FROM blob WHERE rel_path = ?', url.slice('/media/'.length));
          if (blob) tx.run('INSERT OR IGNORE INTO lesson_asset (lesson_id, role, ordinal, blob_sha256, label) VALUES (?, ?, ?, ?, ?)', id, role, ordinal, blob.sha256, label);
        };
        let scene = pictureIn(setup.scene);
        if (typeof setup.sceneUploadId === 'string') {
          const blob = readyUploadBlob(tx, setup.sceneUploadId, ['photo']);
          if (!blob) throw invalid('The scene picture is not ready on this bag. Upload it again.', { scene: 'Upload a picture.' });
          scene = { url: blob.url, alt: scene?.alt ?? (typeof (setup.scene as { alt?: unknown } | null)?.alt === 'string' ? ((setup.scene as { alt: string }).alt) : 'The scene of this lesson') };
        }
        if (!scene) throw invalid('Add the scene picture first.', { scene: 'Upload a picture.' });
        track('scene', 0, scene.url, null);
        const spots = cleanSpots(setup.spots).map((spot, index) => {
          let audioUrl = spot.audioUrl;
          if (spot.audioUploadId) {
            const blob = readyUploadBlob(tx, spot.audioUploadId, ['audio', 'voice-note']);
            if (!blob) throw invalid('A sound for a spot is not ready on this bag yet. Try again in a moment.', { spots: 'Wait for the sound, then save again.' });
            audioUrl = blob.url;
          }
          track('spot_audio', index, audioUrl, spot.id);
          return { id: spot.id, label: spot.label, role: spot.role, says: spot.says, audioUrl, portrait: spot.portrait, x: spot.x, y: spot.y, r: spot.r };
        });
        Object.assign(content, {
          mode: 'hotspots',
          instruction: typeof setup.instruction === 'string' ? setup.instruction.slice(0, 500) : '',
          scene,
          spots,
          goal: setup.goal === 'any' ? 'any' : 'all',
          finishMessage: typeof setup.finishMessage === 'string' ? setup.finishMessage.slice(0, 500) : '',
          gentleMovement: setup.gentleMovement === true,
        });
        delete content.packageUrl;
      } else {
        throw invalid('Choose how to make the Try it lesson.', { mode: 'Choose package or picture.' });
      }
      tx.run('UPDATE lesson SET body_json = ?, version = version + 1, updated_at = ?, seq = ? WHERE id = ?', JSON.stringify(content), nowIso(), tx.seq(), id);
      if (content.mode === 'package') rebuildLessonMedia(tx, id);
      if (lesson.status === 'published') tx.bumpContentRev();
      tx.audit({ actorId: who.id, actorName: who.username, action: 'lesson.tryit', targetType: 'lesson', targetId: id, detail: { mode: content.mode }, clientIp: req.sb.ip });
      return tryItSetup(tx, loadLesson(tx, id));
    });
    sendJson(res, 200, body);
  });

  /* ---------------- admin: series and order ---------------- */
  router.get('/admin/series/:seriesId', admin, (req, res) => {
    sendJson(res, 200, adminSeries(ctx.db, pathParam(req, 'seriesId')));
  });

  router.post('/admin/series', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const input = asObject(req.sb.body);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw invalid('Give the series a name.', { title: 'Type a name.' });
    if (title.length > 120) throw invalid('That name is too long.', { title: 'Use up to 120 letters.' });
    const outcome = await idempotent(ctx, req, { scope: actorScope(req), required: true }, (tx) => {
      const group = tx.get<{ id: string; portal_id: string }>('SELECT id, portal_id FROM content_group WHERE id = ?', String(input.groupId ?? ''));
      if (!group) throw notFound('This group');
      if (group.portal_id !== input.portalId) throw invalid('That group is not in the chosen portal.', { groupId: 'Choose the group again.' });
      const id = newId('se');
      const order = Number(tx.value('SELECT coalesce(max(sort_order), 0) + 1 FROM series WHERE group_id = ?', group.id) ?? 1);
      tx.run(
        "INSERT INTO series (id, group_id, title, description, availability, sort_order, created_by, updated_at, seq) VALUES (?, ?, ?, '', 'available', ?, ?, ?, ?)",
        id,
        group.id,
        title,
        order,
        who.id,
        nowIso(),
        tx.seq(),
      );
      tx.bumpContentRev();
      tx.audit({ actorId: who.id, actorName: who.username, action: 'series.create', targetType: 'series', targetId: id, clientIp: req.sb.ip });
      return { status: 201, body: adminSeries(tx.db, id) };
    });
    sendJson(res, outcome.status, outcome.body);
  });

  router.put('/admin/series/:seriesId/order', admin, async (req, res) => {
    const who = req.sb.admin as AdminIdentity;
    const seriesId = pathParam(req, 'seriesId');
    const input = asObject(req.sb.body);
    const ids = Array.isArray(input.lessonIds) ? input.lessonIds.filter((id): id is string => typeof id === 'string') : [];
    const body = await ctx.write((tx) => {
      if (!tx.get('SELECT 1 FROM series WHERE id = ?', seriesId)) throw notFound('This series');
      const current = numberedIds(tx, seriesId);
      const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((id) => ids.indexOf(id) !== -1);
      if (!same) throw conflict('conflict', 'The series changed while you were working. Open it again to see the newest order.');
      applyOrder(tx, seriesId, ids);
      tx.bumpContentRev();
      tx.audit({ actorId: who.id, actorName: who.username, action: 'series.order', targetType: 'series', targetId: seriesId, detail: { count: ids.length }, clientIp: req.sb.ip });
      return adminSeries(tx.db, seriesId);
    });
    sendJson(res, 200, body);
  });

  /* ---------------- admin: picture gallery (adding a picture is in media) ---------------- */
  router.get('/admin/pictures', admin, (req, res) => {
    interface PictureRow {
      id: string;
      grp: string;
      url_path: string | null;
      rel_path: string | null;
      alt: string;
    }
    const shape = (row: PictureRow) => ({ id: row.id, group: row.grp, url: row.url_path ?? `/media/${row.rel_path}`, alt: row.alt });
    const base = 'SELECT pc.id, pc.grp, pc.url_path, b.rel_path, pc.alt FROM picture pc LEFT JOIN blob b ON b.sha256 = pc.blob_sha256';
    const group = queryString(req, 'group');
    const { page, pageSize, offset } = paging(req);
    const order = "ORDER BY pc.grp = 'own' DESC, pc.grp, pc.created_at DESC, pc.id LIMIT ? OFFSET ?";
    const items = group ? ctx.db.all<PictureRow>(`${base} WHERE pc.grp = ? ${order}`, group, pageSize, offset) : ctx.db.all<PictureRow>(`${base} ${order}`, pageSize, offset);
    const total = Number((group ? ctx.db.value('SELECT count(*) FROM picture WHERE grp = ?', group) : ctx.db.value('SELECT count(*) FROM picture')) ?? 0);
    let suggested: ReturnType<typeof shape>[] = [];
    const suggestFor = queryString(req, 'suggestForLessonId');
    if (suggestFor) {
      // "Suggested" = pictures of the lesson's portal whose description shares a word with the title; at most 3.
      const lesson = ctx.db.get<{ title: string; portal_id: string | null }>(
        'SELECT l.title, g.portal_id FROM lesson l LEFT JOIN series s ON s.id = l.series_id LEFT JOIN content_group g ON g.id = s.group_id WHERE l.id = ?',
        suggestFor,
      );
      if (lesson) {
        const words = lesson.title.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
        const portalGroup = lesson.portal_id === 'primary' || lesson.portal_id === 'jss' ? 'school' : lesson.portal_id;
        suggested = ctx.db
          .all<PictureRow>(`${base} ORDER BY pc.id LIMIT 500`)
          .map((row) => ({ row, score: words.filter((w) => row.alt.toLowerCase().indexOf(w) !== -1).length + (row.grp === portalGroup ? 0.5 : 0) }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((s) => shape(s.row));
      }
    }
    sendJson(res, 200, { suggested, items: items.map(shape), page, pageSize, total });
  });

  return router;
}
