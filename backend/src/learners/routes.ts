/*
 * learners: "Save my progress" (SYSTEM-ARCHITECTURE §5.5, DATABASE §6.3–6.4).
 *
 * - No list endpoint, on purpose: a learner id is the only key to a learner.
 * - Progress is monotonic (finished never goes back to started) and
 *   position-only updates are coalesced to save SD-card writes.
 * - Child protection is never stored per learner in counts-only mode: PUT
 *   progress on such a lesson answers 409 sensitive_lesson and writes nothing;
 *   the anonymous POST /lessons/{id}/activity counts page views in the
 *   separate file counts.sqlite3, with no sequence number and no time of day.
 */
import { Router } from 'express';
import type { Ctx, Tx } from '../core/context.ts';
import { ApiError, asObject, conflict, invalid, notFound } from '../core/errors.ts';
import { hashPassword, verifyPassword } from '../identity/passwords.ts';
import { pathParam, queryString, sendJson, sendNoContent } from '../core/http.ts';
import { idempotent } from '../core/idempotency.ts';
import { LEARNER_ID, newId, sha256Hex } from '../core/ids.ts';
import { dayOf, nowIso } from '../core/time.ts';
import { LESSON_SELECT, summaryOf, type LessonRow } from '../catalog/model.ts';

const ROLE_LABEL: Record<string, string> = { learner: 'Learner', teacher: 'Teacher', other: 'Parent, farmer or other' };
const COALESCE_SECONDS = 10;
const COALESCE_WINDOW_MS = 60_000;

interface LearnerRow {
  id: string;
  name: string;
  role: string;
  last_active_day: string | null;
}

interface ProgressRow {
  lesson_id: string;
  series_id: string | null;
  lesson_type: string;
  state: 'started' | 'finished';
  position_seconds: number | null;
  correct: number | null;
  total: number | null;
  updated_at: string;
}

const learnerBody = (row: LearnerRow) => ({ id: row.id, name: row.name, role: row.role, roleLabel: ROLE_LABEL[row.role] ?? 'Learner' });

const progressBody = (row: ProgressRow) => ({
  lessonId: row.lesson_id,
  seriesId: row.series_id ?? '',
  lessonType: row.lesson_type,
  state: row.state,
  positionSeconds: row.position_seconds,
  correct: row.correct,
  total: row.total,
  updatedAt: row.updated_at,
});

function findLearner(db: { get: Tx['get'] }, id: string): LearnerRow {
  // An id of the wrong shape cannot exist; answering before the query keeps odd strings out of the database layer.
  const row = LEARNER_ID.test(id) ? db.get<LearnerRow>('SELECT id, name, role, last_active_day FROM learner WHERE id = ?', id) : undefined;
  if (!row) throw notFound('This name');
  return row;
}

/** Control characters, zero-width marks and line separators: built from code points so this file holds none of them. */
const INVISIBLE = new RegExp(
  '[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202f], [0xfeff, 0xfeff]].map(([from, to]) => `\\u${(from as number).toString(16).padStart(4, '0')}-\\u${(to as number).toString(16).padStart(4, '0')}`).join('') + ']',
  'g',
);

/** Trim, drop control characters, collapse spaces. */
function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

function optionalCount(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) throw invalid('A number in the progress is not right.', { [field]: 'Use a whole number, 0 or more.' });
  return value;
}

/** Rows a learner may see: published, placed lessons outside sensitive portals (in counts-only mode). */
const VISIBLE = `FROM lesson_progress lp
  JOIN lesson l ON l.id = lp.lesson_id AND l.status = 'published'
  JOIN series s ON s.id = l.series_id
  JOIN content_group g ON g.id = s.group_id
  JOIN portal p ON p.id = g.portal_id
  WHERE lp.learner_id = ? AND (p.sensitive = 0 OR ? = 0)`;

/*
 * The secret number (owner decision, 2026-11-16; replaces "no PIN" of DESIGN-DECISIONS §1).
 *
 * Two learners may have the same name, and a learner must be able to come back on another phone.
 * So a learner chooses a 4-digit number: name + number together identify one learner. The number
 * is stored as an scrypt string (small cost: there are only 10,000 numbers, so the cost protects
 * nothing; it only keeps the plain number out of the database and its backups).
 * Wrong tries are counted per name in memory only (a name is never written anywhere else).
 */
const PIN = /^[0-9]{4}$/;
const PIN_PARAMS = { ln: 12, r: 8, p: 1 };
const MAX_WRONG = 5;
const LOCK_MS = 5 * 60_000;
const wrongTries = new Map<string, { count: number; until: number }>();

/** Names are compared without regard to capitals and accents of composition. */
function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

function pinOf(value: unknown): string {
  const pin = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!PIN.test(pin)) throw invalid('Type 4 numbers.', { pin: 'Type 4 numbers, for example 2 5 8 0.' });
  return pin;
}

/** Every learner whose name is the same (capitals ignored). The table is small; names are not indexed on purpose. */
function sameName(ctx: Ctx, key: string): (LearnerRow & { pin_hash: string | null })[] {
  return ctx.db
    .all<LearnerRow & { pin_hash: string | null }>('SELECT id, name, role, last_active_day, pin_hash FROM learner')
    .filter((row) => nameKey(row.name) === key);
}

async function withPin(rows: (LearnerRow & { pin_hash: string | null })[], pin: string): Promise<LearnerRow | null> {
  for (const row of rows) {
    if (row.pin_hash && (await verifyPassword(pin, row.pin_hash))) return row;
  }
  return null;
}

export function learnerRoutes(ctx: Ctx): Router {
  const router = Router();
  const hide = (): number => (ctx.countsOnly() ? 1 : 0);

  router.post('/learners', async (req, res) => {
    const input = asObject(req.sb.body);
    const name = cleanName(input.name);
    if (!name) throw invalid('Type your name first.', { name: 'Type your name first.' });
    if (name.length > 40) throw invalid('That name is too long.', { name: 'Use a shorter name, up to 40 letters.' });
    const role = input.role === 'teacher' || input.role === 'other' ? input.role : 'learner';
    const pin = pinOf(input.pin);
    const fingerprint = JSON.stringify([name, role, sha256Hex(Buffer.from(`pin:${pin}`))]);
    // Name + number must point at one learner. A replay of the same request is answered from its record below.
    const replay = ctx.db.get("SELECT 1 FROM idempotency_record WHERE scope = 'anon' AND key = ?", String(req.headers['idempotency-key'] ?? ''));
    if (!replay && (await withPin(sameName(ctx, nameKey(name)), pin))) {
      throw new ApiError(409, 'pin_taken', 'Choose a different number.', { fields: { pin: 'Someone with this name already uses this number. Choose a different number.' } });
    }
    const pinHash = await hashPassword(pin, PIN_PARAMS);
    const outcome = await idempotent(ctx, req, { scope: 'anon', required: true, fingerprint }, (tx) => {
      const id = newId('lr');
      tx.run('INSERT INTO learner (id, name, role, created_at, last_active_day, seq, pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, role, nowIso(), dayOf(), tx.seq(), pinHash);
      // The stored answer for replays holds the id only: a name must not outlive its learner in this table.
      return { status: 201, body: learnerBody({ id, name, role, last_active_day: null }), stored: { replayOfLearner: id } };
    });
    const replayed = (outcome.body as { replayOfLearner?: string }).replayOfLearner;
    sendJson(res, outcome.status, replayed ? learnerBody(findLearner(ctx.db, replayed)) : outcome.body);
  });

  /** "I have a name already": name + secret number. The same answer for a wrong name and a wrong number. */
  router.post('/learners/sign-in', async (req, res) => {
    const input = asObject(req.sb.body);
    const name = cleanName(input.name);
    if (!name) throw invalid('Type your name first.', { name: 'Type your name first.' });
    const pin = pinOf(input.pin);
    const key = nameKey(name);
    const now = Date.now();
    const tries = wrongTries.get(key);
    if (tries && tries.until > now) {
      const minutes = Math.max(1, Math.ceil((tries.until - now) / 60_000));
      throw new ApiError(429, 'too_many_tries', `Too many wrong tries. Wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and try again.`);
    }
    const found = await withPin(sameName(ctx, key), pin);
    if (!found) {
      const count = (tries && tries.until <= now && tries.count < MAX_WRONG ? tries.count : 0) + 1;
      if (wrongTries.size > 5000) wrongTries.clear();
      wrongTries.set(key, { count, until: count >= MAX_WRONG ? now + LOCK_MS : 0 });
      throw new ApiError(401, 'wrong_name_or_number', 'The name or the number is not right. Try again.');
    }
    wrongTries.delete(key);
    sendJson(res, 200, learnerBody(found));
  });

  router.get('/learners/:learnerId', (req, res) => {
    sendJson(res, 200, learnerBody(findLearner(ctx.db, pathParam(req, 'learnerId'))));
  });

  router.delete('/learners/:learnerId', async (req, res) => {
    const id = pathParam(req, 'learnerId');
    if (!LEARNER_ID.test(id)) throw notFound('This name');
    // secure_delete for this transaction: the name is overwritten in the database pages (V-013).
    const existed = await ctx.write(
      (tx) => {
        const row = tx.get('SELECT 1 FROM learner WHERE id = ?', id);
        if (!row) return tx.get("SELECT 1 FROM tombstone WHERE entity = 'learner' AND entity_id = ?", id) !== undefined;
        tx.run('DELETE FROM learner WHERE id = ?', id);
        tx.run(
          "INSERT INTO tombstone (entity, entity_id, seq, deleted_at) VALUES ('learner', ?, ?, ?) ON CONFLICT (entity, entity_id) DO UPDATE SET seq = excluded.seq, deleted_at = excluded.deleted_at",
          id,
          tx.seq(),
          nowIso(),
        );
        // Id only; the name is never recorded (DATA-EXPORT §14).
        tx.audit({ action: 'learner.delete', targetType: 'learner', targetId: id, detail: { by: 'learner' } });
        return true;
      },
      { secureDelete: true },
    );
    // 204 again when it was already removed (a tombstone exists); 404 if the id never existed on this bag.
    if (!existed) throw notFound('This name');
    sendNoContent(res);
  });

  router.get('/learners/:learnerId/progress', (req, res) => {
    const learner = findLearner(ctx.db, pathParam(req, 'learnerId'));
    const portalId = queryString(req, 'portalId');
    const seriesId = queryString(req, 'seriesId');
    let sql = `SELECT lp.lesson_id, l.series_id, l.type AS lesson_type, lp.state, lp.position_seconds, lp.correct, lp.total, lp.updated_at ${VISIBLE}`;
    const params: (string | number)[] = [learner.id, hide()];
    if (portalId) {
      sql += ' AND p.id = ?';
      params.push(portalId);
    }
    if (seriesId) {
      sql += ' AND l.series_id = ?';
      params.push(seriesId);
    }
    sendJson(res, 200, { learnerId: learner.id, lessons: ctx.db.all<ProgressRow>(`${sql} ORDER BY lp.seq`, ...params).map(progressBody) });
  });

  router.put('/learners/:learnerId/progress/:lessonId', async (req, res) => {
    const learnerId = pathParam(req, 'learnerId');
    const lessonId = pathParam(req, 'lessonId');
    const update = asObject(req.sb.body);
    const state = update.state;
    if (state !== 'not-started' && state !== 'started' && state !== 'finished') throw invalid('The progress state is missing.', { state: 'Use not-started, started or finished.' });
    const position = optionalCount(update.positionSeconds, 'positionSeconds');
    const correct = optionalCount(update.correct, 'correct');
    const total = optionalCount(update.total, 'total');

    const body = await ctx.write((tx) => {
      const learner = findLearner(tx, learnerId);
      const lesson = tx.get<{ id: string; series_id: string; type: string; sensitive: number }>(
        `SELECT l.id, l.series_id, l.type, p.sensitive FROM lesson l
           JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id
          WHERE l.id = ? AND l.status = 'published'`,
        lessonId,
      );
      if (!lesson) throw notFound('This lesson');
      // Only old or wrong clients get here; nothing is written (ADR-009).
      if (lesson.sensitive === 1 && ctx.countsOnly()) throw conflict('sensitive_lesson', 'Progress is not saved for this lesson.');
      const existing = tx.get<ProgressRow>(
        'SELECT lesson_id, NULL AS series_id, NULL AS lesson_type, state, position_seconds, correct, total, updated_at FROM lesson_progress WHERE learner_id = ? AND lesson_id = ?',
        learner.id,
        lesson.id,
      );
      const shape = (row: Pick<ProgressRow, 'state' | 'position_seconds' | 'correct' | 'total' | 'updated_at'>) =>
        progressBody({
          lesson_id: lesson.id,
          series_id: lesson.series_id,
          lesson_type: lesson.type,
          state: row.state,
          position_seconds: row.position_seconds,
          correct: row.correct,
          total: row.total,
          updated_at: row.updated_at,
        });
      const now = nowIso();
      if (state === 'not-started') {
        // 'not-started' is the absence of a row; it never erases what is stored.
        return existing ? shape(existing) : { ...shape({ state: 'started', position_seconds: null, correct: null, total: null, updated_at: now }), state: 'not-started' };
      }
      // A finished lesson stays finished when it is opened again.
      const nextState = existing && existing.state === 'finished' ? 'finished' : state;
      const nextPosition = position === undefined ? (existing ? existing.position_seconds : null) : position;
      const nextCorrect = correct === undefined || correct === null ? (existing ? existing.correct : null) : correct;
      const nextTotal = total === undefined || total === null ? (existing ? existing.total : null) : total;
      if (nextCorrect !== null && nextTotal !== null && nextCorrect > nextTotal) throw invalid('The score is larger than the number of questions.', { correct: 'Check the score.' });
      if (existing) {
        const sameRest = nextState === existing.state && nextCorrect === existing.correct && nextTotal === existing.total;
        const moved = Math.abs((nextPosition ?? 0) - (existing.position_seconds ?? 0));
        const age = Date.parse(now) - Date.parse(existing.updated_at);
        // Coalescing (DATABASE §4.4): a small move of the position soon after the last write is not written.
        if (sameRest && ((nextPosition === existing.position_seconds) || (moved < COALESCE_SECONDS && age >= 0 && age < COALESCE_WINDOW_MS))) return shape(existing);
      }
      tx.run(
        `INSERT INTO lesson_progress (learner_id, lesson_id, state, position_seconds, correct, total, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (learner_id, lesson_id) DO UPDATE SET state = excluded.state, position_seconds = excluded.position_seconds, correct = excluded.correct,
           total = excluded.total, updated_at = excluded.updated_at, seq = excluded.seq`,
        learner.id,
        lesson.id,
        nextState,
        nextPosition,
        nextCorrect,
        nextTotal,
        now,
        tx.seq(),
      );
      const today = dayOf();
      if (learner.last_active_day !== today) tx.run('UPDATE learner SET last_active_day = ?, seq = ? WHERE id = ?', today, tx.seq(), learner.id);
      return shape({ state: nextState, position_seconds: nextPosition, correct: nextCorrect, total: nextTotal, updated_at: now });
    });
    sendJson(res, 200, body);
  });

  router.get('/learners/:learnerId/continue', (req, res) => {
    const learner = findLearner(ctx.db, pathParam(req, 'learnerId'));
    const portalId = queryString(req, 'portalId');
    const params: (string | number)[] = [learner.id, hide()];
    let sql = `SELECT lp.lesson_id, s.title AS series_title ${VISIBLE} AND lp.state = 'started'`;
    if (portalId) {
      sql += ' AND p.id = ?';
      params.push(portalId);
    }
    // The most recently changed lesson: by change sequence, never by the wall clock (ADR-014).
    const found = ctx.db.get<{ lesson_id: string; series_title: string }>(`${sql} ORDER BY lp.seq DESC LIMIT 1`, ...params);
    if (!found) {
      sendJson(res, 200, null);
      return;
    }
    const lesson = ctx.db.get<LessonRow>(`${LESSON_SELECT} WHERE l.id = ?`, found.lesson_id) as LessonRow;
    const count = Number(ctx.db.value("SELECT count(*) FROM lesson WHERE series_id = ? AND status = 'published' AND type <> 'check'", lesson.series_id) ?? 0);
    sendJson(res, 200, { lesson: summaryOf(lesson), seriesTitle: found.series_title, lessonCount: count });
  });

  /* ---- anonymous Child protection activity (DATABASE §6.4) ---- */
  router.post('/lessons/:lessonId/activity', async (req, res) => {
    const lessonId = pathParam(req, 'lessonId');
    const input = asObject(req.sb.body);
    const event = input.event;
    const viewId = input.viewId;
    if (event !== 'opened' && event !== 'finished') throw invalid('The event is not known.', { event: 'Use opened or finished.' });
    if (typeof viewId !== 'string' || !/^[0-9a-f]{32}$/.test(viewId)) throw invalid('The view id is not right.', { viewId: 'Use 32 hex characters.' });
    const lesson = ctx.db.get<{ sensitive: number }>(
      `SELECT p.sensitive FROM lesson l JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id
        WHERE l.id = ? AND l.status = 'published'`,
      lessonId,
    );
    if (!lesson) throw notFound('This lesson');
    if (lesson.sensitive !== 1) throw new ApiError(409, 'not_sensitive', 'This lesson does not use anonymous counts.');
    const day = dayOf();
    // Its own file, its own transaction: nothing is appended to sensebod-offline.sqlite3 or its WAL (V-019). No seq, no time of day.
    await ctx.writeCounts((counts) => {
      const inserted = counts.run('INSERT OR IGNORE INTO sensitive_activity_seen (view_id, lesson_id, event, day) VALUES (?, ?, ?, ?)', viewId, lessonId, event, day);
      if (inserted !== 1) return;
      if (event === 'opened') {
        counts.run('INSERT INTO sensitive_activity_count (lesson_id, day, opened, finished) VALUES (?, ?, 1, 0) ON CONFLICT (lesson_id, day) DO UPDATE SET opened = opened + 1', lessonId, day);
      } else {
        counts.run('INSERT INTO sensitive_activity_count (lesson_id, day, opened, finished) VALUES (?, ?, 0, 1) ON CONFLICT (lesson_id, day) DO UPDATE SET finished = finished + 1', lessonId, day);
      }
    });
    sendNoContent(res);
  });

  return router;
}
