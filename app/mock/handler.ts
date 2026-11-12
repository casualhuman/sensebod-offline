/*
 * Mock implementation of docs/API-CONTRACT.md, as one pure function:
 * request in, response out, over an in-memory database.
 *
 * Used in two places, never in production:
 *   - the dev / preview server (build/mockApiPlugin.ts)
 *   - unit tests (mock/installMockFetch.ts)
 *
 * State lives in memory: restarting the dev server (or `resetMockDb()`)
 * restores the seed.
 */
import type {
  AdminLesson,
  ApiErrorBody,
  ContinueLesson,
  Group,
  GroupDetail,
  Learner,
  LearnerProgress,
  Lesson,
  LessonPatch,
  LessonProgress,
  LessonSummary,
  LessonType,
  LibraryPage,
  NewLearner,
  NewLesson,
  NewSeries,
  PackageCheck,
  PicturePage,
  PortalCount,
  PortalDetail,
  ProgressUpdate,
  QuestionSet,
  SeriesDetail,
  SeriesOrder,
  SeriesSummary,
  StorageInfo,
  TryItSetup,
  Upload,
  UploadKind,
} from '../src/shared/api/types.ts';
import { createDb, SAMPLE_PACKAGE, slug, type GroupRecord, type LessonRecord, type MockDb, type SeriesRecord } from './data/seed.ts';

export interface MockRequest {
  method: string;
  /** Full path, e.g. "/api/v1/portals". */
  path: string;
  query: URLSearchParams;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Parsed JSON body, if any. */
  body?: unknown;
  /** Size of the raw body (uploads are counted, not stored). */
  bodyBytes?: number;
}

export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Demo credentials for the mock admin. The real backend has its own accounts. */
export const MOCK_ADMIN = { username: 'admin', password: 'sensebod', displayName: '[Staff name]' };
const SESSION_COOKIE = 'sb_admin=mock-session';
const BASE = '/api/v1';

let db: MockDb = createDb();
let delayMs = 0;
let failNext: { status: number; count: number } | null = null;

/** Start again from the seed. */
export function resetMockDb(): void {
  db = createDb();
  failNext = null;
}

/** Direct access for tests that need to arrange data. */
export function getMockDb(): MockDb {
  return db;
}

/** Slow every answer down (to see loading states) or make the next answers fail (to see error states). */
export const mockControls = {
  setDelay(ms: number): void {
    delayMs = Math.max(0, ms);
  },
  failNext(status = 500, count = 1): void {
    failNext = { status, count };
  },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const notFound = (what: string) => new HttpError(404, 'not_found', `${what} is not in this bag.`);
const invalid = (message: string, fields?: Record<string, string>) => new HttpError(422, 'validation', message, fields);

function errorBody(code: string, message: string, fields?: Record<string, string>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  db.nextId += 1;
  return `${prefix}-${db.nextId}`;
}

function asObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  throw invalid('The request had no readable content.');
}

function published(lesson: LessonRecord): boolean {
  return lesson.status === 'published' && lesson.placement !== null;
}

function seriesLessons(seriesId: string, includeDrafts = false): LessonRecord[] {
  return db.lessons
    .filter((lesson) => lesson.seriesId === seriesId && (includeDrafts || published(lesson)))
    .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
}

function toSummary(lesson: LessonRecord): LessonSummary {
  return {
    id: lesson.id,
    seriesId: lesson.seriesId,
    position: lesson.position,
    title: lesson.title,
    summary: lesson.summary,
    picture: lesson.picture,
    language: lesson.language,
    type: lesson.type,
    interactive: lesson.interactive,
    captions: lesson.captions,
    readAlong: lesson.readAlong,
    needsSound: lesson.needsSound,
    length: lesson.length,
    pages: lesson.pages,
  };
}

function toAdminLesson(lesson: LessonRecord): AdminLesson {
  // Everything except the learner-side content.
  const copy: Partial<LessonRecord> = { ...lesson };
  delete copy.content;
  delete copy.listenUrl;
  return copy as AdminLesson;
}

function toSeriesSummary(series: SeriesRecord): SeriesSummary {
  const lessons = seriesLessons(series.id);
  return {
    id: series.id,
    portalId: series.portalId,
    groupId: series.groupId,
    title: series.title,
    description: series.description,
    picture: series.picture,
    availability: series.availability,
    lessonCount: lessons.filter((lesson) => lesson.type !== 'check').length,
    hasQuiz: lessons.some((lesson) => lesson.type === 'check'),
  };
}

function toGroup(group: GroupRecord): Group {
  const series = db.series.filter((s) => s.groupId === group.id);
  const lessons = series.flatMap((s) => seriesLessons(s.id)).filter((lesson) => lesson.type !== 'check');
  const types: LessonType[] = [];
  for (const lesson of lessons) if (types.indexOf(lesson.type) === -1) types.push(lesson.type);
  return {
    id: group.id,
    portalId: group.portalId,
    kind: group.kind,
    title: group.title,
    description: group.description,
    picture: group.picture,
    availability: group.availability,
    lessonCount: lessons.length,
    lessonTypes: types,
    seriesCount: series.length,
    onlySeriesId: series.length === 1 ? (series[0] as SeriesRecord).id : null,
  };
}

function portalRef(portalId: string) {
  const portal = db.portals.find((p) => p.id === portalId);
  if (!portal) throw notFound('This portal');
  return { id: portal.id, title: portal.title, theme: portal.theme, groupKind: portal.groupKind };
}

function findLesson(id: string): LessonRecord {
  const lesson = db.lessons.find((l) => l.id === id);
  if (!lesson) throw notFound('This lesson');
  return lesson;
}

function findSeries(id: string): SeriesRecord {
  const series = db.series.find((s) => s.id === id);
  if (!series) throw notFound('This series');
  return series;
}

function findGroup(id: string): GroupRecord {
  const group = db.groups.find((g) => g.id === id);
  if (!group) throw notFound('This group');
  return group;
}

function findLearner(id: string): Learner {
  const learner = db.learners.find((l) => l.id === id);
  if (!learner) throw notFound('This name');
  return learner;
}

/** Renumber the lessons of a series 1..n in their current order; the quiz keeps position null. */
function renumber(seriesId: string): void {
  let position = 0;
  for (const lesson of seriesLessons(seriesId, true)) {
    if (lesson.type === 'check') {
      lesson.position = null;
      continue;
    }
    position += 1;
    lesson.position = position;
    if (lesson.placement) lesson.placement.position = position;
  }
}

function placementLabel(seriesId: string): string {
  const series = findSeries(seriesId);
  return `${portalRef(series.portalId).title} → ${findGroup(series.groupId).title} → ${series.title}`;
}

function requireAdmin(request: MockRequest): void {
  if ((request.headers.cookie ?? '').indexOf(SESSION_COOKIE) === -1) {
    throw new HttpError(401, 'unauthorised', 'Sign in to use the admin.');
  }
}

/** The automatic type rule: the type is set from what is uploaded. */
export function classifyFile(fileName: string): { kind: UploadKind; becomes: LessonType | null } {
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] ?? '').toLowerCase();
  if (['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', 'avi'].indexOf(ext) !== -1) return { kind: 'video', becomes: 'watch' };
  if (['opus', 'ogg', 'amr'].indexOf(ext) !== -1) return { kind: 'voice-note', becomes: 'listen' };
  if (['mp3', 'm4a', 'aac', 'wav'].indexOf(ext) !== -1) return { kind: 'audio', becomes: 'listen' };
  if (ext === 'pdf') return { kind: 'pdf', becomes: 'read' };
  if (ext === 'doc' || ext === 'docx') return { kind: 'word', becomes: 'read' };
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].indexOf(ext) !== -1) return { kind: 'photo', becomes: 'read' };
  if (ext === 'zip') return { kind: 'animation', becomes: 'try' };
  if (ext === 'h5p') return { kind: 'h5p', becomes: 'try' };
  return { kind: 'unknown', becomes: null };
}

function packageChecks(kind: UploadKind, sizeBytes: number): PackageCheck[] {
  if (kind === 'h5p') {
    return [{ id: 'player', ok: false, title: 'Needs the H5P player on this bag', detail: 'Ask EasySTEM to add the H5P player.' }];
  }
  if (kind !== 'animation') return [];
  const mb = Math.max(1, Math.round(sizeBytes / (1024 * 1024)));
  return [
    { id: 'offline', ok: true, title: 'Opens without internet', detail: 'Everything it needs is inside the file.' },
    { id: 'index', ok: true, title: 'Starts with index.html', detail: 'Found at the top of the .zip.' },
    { id: 'size', ok: mb <= 50, title: `Size: ${mb} MB`, detail: mb <= 50 ? 'Fine for old phones.' : 'Large for old phones. Ask EasySTEM for a smaller version.' },
  ];
}

function intParam(query: URLSearchParams, name: string, fallback: number, max: number): number {
  const value = Number(query.get(name));
  return Number.isFinite(value) && value >= 1 ? Math.min(max, Math.floor(value)) : fallback;
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

type Handler = (request: MockRequest, params: string[]) => MockResponse;

const ok = (body: unknown, status = 200): MockResponse => ({ status, body });
const noContent = (): MockResponse => ({ status: 204 });

const routes: [method: string, pattern: RegExp, handler: Handler, admin?: boolean][] = [
  /* ---- learner: content ---- */
  ['GET', /^\/portals$/, () => ok(db.portals)],
  [
    'GET',
    /^\/portals\/([^/]+)$/,
    (_request, [portalId = '']) => {
      const portal = db.portals.find((p) => p.id === portalId);
      if (!portal) throw notFound('This portal');
      const detail: PortalDetail = { ...portal, groups: db.groups.filter((g) => g.portalId === portal.id).map(toGroup) };
      return ok(detail);
    },
  ],
  [
    'GET',
    /^\/groups\/([^/]+)$/,
    (_request, [groupId = '']) => {
      const group = findGroup(groupId);
      const detail: GroupDetail = {
        ...toGroup(group),
        portal: portalRef(group.portalId),
        series: db.series.filter((s) => s.groupId === group.id).map(toSeriesSummary),
      };
      return ok(detail);
    },
  ],
  [
    'GET',
    /^\/series\/([^/]+)$/,
    (_request, [seriesId = '']) => {
      const series = findSeries(seriesId);
      const group = findGroup(series.groupId);
      const detail: SeriesDetail = {
        ...toSeriesSummary(series),
        portal: portalRef(series.portalId),
        group: { id: group.id, title: group.title, kind: group.kind },
        lessons: seriesLessons(series.id).map(toSummary),
        listenUrl: series.listenUrl,
      };
      return ok(detail);
    },
  ],
  [
    'GET',
    /^\/lessons\/([^/]+)$/,
    (_request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      if (!published(lesson)) throw notFound('This lesson');
      const series = findSeries(lesson.seriesId);
      const group = findGroup(series.groupId);
      const inSeries = seriesLessons(series.id);
      const next = inSeries[inSeries.findIndex((l) => l.id === lesson.id) + 1];
      const detail: Lesson = {
        ...toSummary(lesson),
        portal: portalRef(series.portalId),
        group: { id: group.id, title: group.title, kind: group.kind },
        series: { id: series.id, title: series.title, lessonCount: inSeries.filter((l) => l.type !== 'check').length },
        next: next ? toSummary(next) : null,
        listenUrl: lesson.listenUrl,
        content: lesson.content,
      };
      return ok(detail);
    },
  ],

  /* ---- learner: save my progress ---- */
  [
    'POST',
    /^\/learners$/,
    (request) => {
      const input = asObject(request.body) as Partial<NewLearner>;
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) throw invalid('Type your name first.', { name: 'Type your name first.' });
      if (name.length > 40) throw invalid('That name is too long.', { name: 'Use a shorter name, up to 40 letters.' });
      const role = input.role === 'teacher' || input.role === 'other' ? input.role : 'learner';
      const key = request.headers['idempotency-key'];
      if (key && db.idempotency[key]) return ok(findLearner(db.idempotency[key] as string), 200);
      const learner: Learner = {
        id: newId('learner'),
        name,
        role,
        roleLabel: role === 'teacher' ? 'Teacher' : role === 'other' ? 'Parent, farmer or other' : 'Learner',
      };
      db.learners.push(learner);
      db.progress[learner.id] = [];
      if (key) db.idempotency[key] = learner.id;
      return ok(learner, 201);
    },
  ],
  ['GET', /^\/learners\/([^/]+)$/, (_request, [learnerId = '']) => ok(findLearner(learnerId))],
  [
    'DELETE',
    /^\/learners\/([^/]+)$/,
    (_request, [learnerId = '']) => {
      findLearner(learnerId);
      db.learners = db.learners.filter((l) => l.id !== learnerId);
      delete db.progress[learnerId];
      return noContent();
    },
  ],
  [
    'GET',
    /^\/learners\/([^/]+)\/progress$/,
    (request, [learnerId = '']) => {
      findLearner(learnerId);
      const seriesId = request.query.get('seriesId');
      const portalId = request.query.get('portalId');
      let lessons = db.progress[learnerId] ?? [];
      if (seriesId) lessons = lessons.filter((p) => p.seriesId === seriesId);
      if (portalId) {
        const seriesIds = db.series.filter((s) => s.portalId === portalId).map((s) => s.id);
        lessons = lessons.filter((p) => seriesIds.indexOf(p.seriesId) !== -1);
      }
      const result: LearnerProgress = { learnerId, lessons };
      return ok(result);
    },
  ],
  [
    'PUT',
    /^\/learners\/([^/]+)\/progress\/([^/]+)$/,
    (request, [learnerId = '', lessonId = '']) => {
      findLearner(learnerId);
      const lesson = findLesson(lessonId);
      const update = asObject(request.body) as Partial<ProgressUpdate>;
      if (update.state !== 'not-started' && update.state !== 'started' && update.state !== 'finished') {
        throw invalid('The progress state is missing.', { state: 'Use not-started, started or finished.' });
      }
      const list = db.progress[learnerId] ?? (db.progress[learnerId] = []);
      const existing = list.find((p) => p.lessonId === lessonId);
      // A finished lesson stays finished when it is opened again.
      const state = existing && existing.state === 'finished' ? 'finished' : update.state;
      const entry: LessonProgress = {
        lessonId,
        seriesId: lesson.seriesId,
        state,
        positionSeconds: update.positionSeconds ?? existing?.positionSeconds ?? null,
        correct: update.correct ?? existing?.correct ?? null,
        total: update.total ?? existing?.total ?? null,
        updatedAt: now(),
      };
      if (existing) list[list.indexOf(existing)] = entry;
      else list.push(entry);
      return ok(entry);
    },
  ],
  [
    'GET',
    /^\/learners\/([^/]+)\/continue$/,
    (request, [learnerId = '']) => {
      findLearner(learnerId);
      const portalId = request.query.get('portalId');
      const started = (db.progress[learnerId] ?? [])
        .filter((p) => p.state === 'started')
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      for (const entry of started) {
        const lesson = db.lessons.find((l) => l.id === entry.lessonId);
        if (!lesson || !published(lesson)) continue;
        const series = findSeries(lesson.seriesId);
        if (portalId && series.portalId !== portalId) continue;
        const result: ContinueLesson = {
          lesson: toSummary(lesson),
          seriesTitle: series.title,
          lessonCount: seriesLessons(series.id).filter((l) => l.type !== 'check').length,
        };
        return ok(result);
      }
      return ok(null);
    },
  ],

  /* ---- admin: session (no sign-in needed for these three) ---- */
  [
    'POST',
    /^\/admin\/session$/,
    (request) => {
      const input = asObject(request.body);
      if (input.username !== MOCK_ADMIN.username || input.password !== MOCK_ADMIN.password) {
        throw new HttpError(401, 'bad_credentials', 'That username or password is not right. Try again.');
      }
      return {
        status: 200,
        headers: { 'Set-Cookie': `${SESSION_COOKIE}; Path=/; HttpOnly; SameSite=Strict` },
        body: { username: MOCK_ADMIN.username, displayName: MOCK_ADMIN.displayName },
      };
    },
  ],
  [
    'GET',
    /^\/admin\/session$/,
    (request) => {
      requireAdmin(request);
      return ok({ username: MOCK_ADMIN.username, displayName: MOCK_ADMIN.displayName });
    },
  ],
  ['DELETE', /^\/admin\/session$/, () => ({ status: 204, headers: { 'Set-Cookie': 'sb_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' } })],

  /* ---- admin: library ---- */
  [
    'GET',
    /^\/admin\/lessons$/,
    (request) => {
      const q = request.query;
      const search = (q.get('search') ?? '').trim().toLowerCase();
      const unplaced = q.get('unplaced') === 'true';
      let items = db.lessons.filter((lesson) => {
        if (unplaced) return lesson.placement === null;
        if (q.get('portalId') && lesson.placement?.portalId !== q.get('portalId')) return false;
        if (q.get('groupId') && lesson.placement?.groupId !== q.get('groupId')) return false;
        if (q.get('seriesId') && lesson.placement?.seriesId !== q.get('seriesId')) return false;
        if (q.get('type') && lesson.type !== q.get('type')) return false;
        if (q.get('status') && lesson.status !== q.get('status')) return false;
        if (search) {
          const haystack = [lesson.title, lesson.placementLabel ?? '', ...lesson.fileNames].join(' ').toLowerCase();
          if (haystack.indexOf(search) === -1) return false;
        }
        return true;
      });
      items = items.sort((a, b) => {
        const sa = a.placement ? `${a.placement.portalId}/${a.placement.groupId}/${a.placement.seriesId}` : '~';
        const sb = b.placement ? `${b.placement.portalId}/${b.placement.groupId}/${b.placement.seriesId}` : '~';
        if (sa !== sb) return sa < sb ? -1 : 1;
        return (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
      });
      const pageSize = intParam(q, 'pageSize', 25, 100);
      const page = intParam(q, 'page', 1, 10000);
      const result: LibraryPage = {
        items: items.slice((page - 1) * pageSize, page * pageSize).map(toAdminLesson),
        page,
        pageSize,
        total: items.length,
        publishedCount: items.filter((l) => l.status === 'published').length,
        draftCount: items.filter((l) => l.status === 'draft').length,
      };
      return ok(result);
    },
    true,
  ],
  [
    'GET',
    /^\/admin\/portals$/,
    () => {
      const counts: PortalCount[] = db.portals.map((portal) => ({
        portalId: portal.id,
        title: portal.title,
        description: portal.description,
        lessonCount: db.lessons.filter((l) => l.placement?.portalId === portal.id && l.type !== 'check').length,
      }));
      return ok(counts);
    },
    true,
  ],
  [
    'GET',
    /^\/admin\/storage$/,
    () => {
      // Totals are placeholders on the boards ("[used] of [total] GB"): null until the Pi measures them.
      const info: StorageInfo = {
        usedBytes: null,
        totalBytes: null,
        breakdown: [
          { label: 'Agriculture livestock videos', bytes: Math.round(3.3 * 1024 * 1024 * 1024) },
          { label: 'Other lessons', bytes: null },
          { label: 'Free', bytes: null },
        ],
      };
      return ok(info);
    },
    true,
  ],
  ['GET', /^\/admin\/lessons\/([^/]+)$/, (_request, [lessonId = '']) => ok(toAdminLesson(findLesson(lessonId))), true],

  /* ---- admin: uploads ---- */
  [
    'POST',
    /^\/admin\/uploads$/,
    (request) => {
      const fileName = decodeURIComponent(request.headers['x-file-name'] ?? '').trim();
      if (!fileName) throw invalid('The file has no name.', { file: 'Choose the file again.' });
      const { kind, becomes } = classifyFile(fileName);
      if (!becomes) {
        throw new HttpError(415, 'unsupported_file', 'This kind of file cannot be added. Use video, audio, PDF, Word, photos or an animation package.');
      }
      const sizeBytes = request.bodyBytes ?? 0;
      const needsWork = kind === 'voice-note' || kind === 'pdf' || kind === 'word' || (kind === 'video' && request.query.get('smallerCopy') === 'true');
      const upload: Upload = {
        id: newId('upload'),
        fileName,
        sizeBytes,
        kind,
        becomes,
        durationSeconds: null,
        pages: kind === 'photo' ? 1 : null,
        processing: needsWork
          ? { state: 'working', note: kind === 'voice-note' ? 'Converting so every phone can play it.' : kind === 'video' ? 'Making a smaller copy for old phones.' : 'Getting the pages ready to read on any phone.' }
          : { state: 'ready', note: null },
        checks: packageChecks(kind, sizeBytes),
      };
      db.uploads.push(upload);
      return ok(upload, 201);
    },
    true,
  ],
  [
    'GET',
    /^\/admin\/uploads\/([^/]+)$/,
    (_request, [uploadId = '']) => {
      const upload = db.uploads.find((u) => u.id === uploadId);
      if (!upload) throw notFound('This file');
      // The mock finishes server-side work the first time it is asked.
      if (upload.processing.state === 'working') {
        upload.processing = { state: 'ready', note: upload.kind === 'voice-note' ? 'Converted. Ready on this bag.' : 'Ready on this bag.' };
      }
      return ok(upload);
    },
    true,
  ],
  [
    'DELETE',
    /^\/admin\/uploads\/([^/]+)$/,
    (_request, [uploadId = '']) => {
      db.uploads = db.uploads.filter((u) => u.id !== uploadId);
      return noContent();
    },
    true,
  ],

  /* ---- admin: lessons ---- */
  [
    'POST',
    /^\/admin\/lessons$/,
    (request) => {
      const input = asObject(request.body) as Partial<NewLesson>;
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title) throw invalid('Give the lesson a title learners will see.', { title: 'Type a title.' });
      const key = request.headers['idempotency-key'];
      if (key && db.idempotency[key]) return ok(toAdminLesson(findLesson(db.idempotency[key] as string)));
      const uploads = (input.uploadIds ?? []).map((id) => {
        const upload = db.uploads.find((u) => u.id === id);
        if (!upload) throw invalid('One of the files is no longer on this bag. Upload it again.', { uploadIds: id });
        return upload;
      });
      let type: LessonType = 'read';
      if (input.source === 'upload' || input.source === 'animation') {
        if (uploads.length !== 1) throw invalid('Choose one file for this lesson.', { uploadIds: 'One file is needed.' });
        type = (uploads[0] as Upload).becomes ?? 'read';
      } else if (input.source === 'notes-photos') {
        if (uploads.length === 0) throw invalid('Add at least one photo of your notes.', { uploadIds: 'Add a photo.' });
      } else if (input.source === 'typed') {
        if (!input.blocks || input.blocks.length === 0) throw invalid('Write the lesson text first.', { blocks: 'The lesson is empty.' });
      } else if (input.source === 'questions') {
        type = 'check';
      } else {
        throw invalid('Say where the content comes from.', { source: 'Unknown source.' });
      }
      const id = newId('lesson');
      const first = uploads[0];
      const lesson: LessonRecord = {
        id,
        seriesId: '',
        position: null,
        title,
        summary: '',
        picture: null,
        language: 'en',
        type,
        interactive: type === 'try',
        captions: false,
        readAlong: Boolean(input.readAlongUploadId),
        needsSound: type === 'watch' || type === 'listen',
        length: first?.durationSeconds ?? null,
        pages: input.source === 'notes-photos' ? uploads.length : (first?.pages ?? null),
        status: 'draft',
        placement: null,
        placementLabel: null,
        source: input.source,
        fileNames: uploads.map((u) => u.fileName),
        questionCount: type === 'check' ? 0 : null,
        pictureId: null,
        updatedAt: now(),
        notes: type === 'listen' ? ['Read along text not added. It helps learners who cannot hear well.'] : [],
        listenUrl: null,
        content:
          type === 'watch'
            ? { type: 'watch', sources: [{ url: '/media/sample-video.mp4', mimeType: 'video/mp4' }], poster: null, captions: [], questions: [], learningPoints: [] }
            : type === 'listen'
              ? { type: 'listen', sources: [{ url: '/media/sample-audio.m4a', mimeType: 'audio/mp4' }], cover: null, transcript: [] }
              : type === 'try'
                ? { type: 'try', mode: 'package', packageUrl: SAMPLE_PACKAGE }
                : type === 'check'
                  ? { type: 'check', questions: [] }
                  : { type: 'read', blocks: input.blocks ?? [], pageImages: [], audio: null, cover: null },
      };
      db.lessons.push(lesson);
      if (key) db.idempotency[key] = id;
      return ok(toAdminLesson(lesson), 201);
    },
    true,
  ],
  [
    'PATCH',
    /^\/admin\/lessons\/([^/]+)$/,
    (request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      const patch = asObject(request.body) as LessonPatch;
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw invalid('Give the lesson a title learners will see.', { title: 'Type a title.' });
        lesson.title = patch.title.trim();
      }
      if (patch.summary !== undefined) lesson.summary = patch.summary;
      if (patch.type !== undefined) lesson.type = patch.type;
      if (patch.interactive !== undefined) lesson.interactive = patch.interactive;
      if (patch.blocks !== undefined && lesson.content.type === 'read') lesson.content = { ...lesson.content, blocks: patch.blocks };
      if (patch.transcript !== undefined && lesson.content.type === 'listen') {
        lesson.content = { ...lesson.content, transcript: patch.transcript };
        lesson.notes = lesson.notes.filter((note) => note.indexOf('Read along') !== 0);
      }
      if (patch.pictureId !== undefined) {
        const picture = patch.pictureId === null ? null : db.pictures.find((p) => p.id === patch.pictureId);
        if (picture === undefined) throw invalid('That picture is not in the gallery.', { pictureId: 'Choose another picture.' });
        lesson.pictureId = patch.pictureId;
        lesson.picture = picture ? { url: picture.url, alt: picture.alt } : null;
      }
      if (patch.placement !== undefined) {
        const oldSeries = lesson.seriesId;
        if (patch.placement === null) {
          lesson.placement = null;
          lesson.placementLabel = null;
          lesson.seriesId = '';
          lesson.position = null;
          lesson.status = 'draft';
        } else {
          const series = findSeries(patch.placement.seriesId);
          if (series.groupId !== patch.placement.groupId || series.portalId !== patch.placement.portalId) {
            throw invalid('That series is not in the chosen portal and group.', { placement: 'Choose the series again.' });
          }
          const others = seriesLessons(series.id, true).filter((l) => l.id !== lesson.id && l.type !== 'check');
          const index = Math.max(0, Math.min(others.length, Math.floor(patch.placement.position) - 1));
          others.splice(index, 0, lesson);
          lesson.seriesId = series.id;
          lesson.placement = { ...patch.placement, position: index + 1 };
          lesson.placementLabel = placementLabel(series.id);
          others.forEach((l, i) => {
            l.position = l.type === 'check' ? null : i + 1;
            if (l.placement) l.placement.position = i + 1;
          });
        }
        if (oldSeries && oldSeries !== lesson.seriesId) renumber(oldSeries);
      }
      lesson.updatedAt = now();
      return ok(toAdminLesson(lesson));
    },
    true,
  ],
  [
    'POST',
    /^\/admin\/lessons\/([^/]+)\/(publish|unpublish)$/,
    (_request, [lessonId = '', action = '']) => {
      const lesson = findLesson(lessonId);
      if (action === 'publish') {
        if (!lesson.placement) throw new HttpError(409, 'not_placed', 'Choose where this lesson goes before you publish it.');
        lesson.status = 'published';
      } else {
        lesson.status = 'draft';
      }
      lesson.updatedAt = now();
      return ok(toAdminLesson(lesson));
    },
    true,
  ],
  [
    'DELETE',
    /^\/admin\/lessons\/([^/]+)$/,
    (_request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      db.lessons = db.lessons.filter((l) => l.id !== lessonId);
      if (lesson.seriesId) renumber(lesson.seriesId);
      return noContent();
    },
    true,
  ],

  /* ---- admin: pictures ---- */
  [
    'GET',
    /^\/admin\/pictures$/,
    (request) => {
      const group = request.query.get('group');
      const suggestFor = request.query.get('suggestForLessonId');
      const all = group ? db.pictures.filter((p) => p.group === group) : db.pictures;
      const pageSize = intParam(request.query, 'pageSize', 12, 60);
      const page = intParam(request.query, 'page', 1, 1000);
      let suggested: PicturePage['suggested'] = [];
      if (suggestFor) {
        const lesson = db.lessons.find((l) => l.id === suggestFor);
        const portalId = lesson?.placement?.portalId ?? 'child-protection';
        const words = (lesson?.title ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
        const scored = db.pictures
          .map((p) => ({ p, score: words.filter((w) => p.alt.toLowerCase().indexOf(w) !== -1).length + (p.url.indexOf(`/illustrations/${portalId}/scenes/`) === 0 ? 0.5 : 0) }))
          .sort((a, b) => b.score - a.score);
        suggested = scored.slice(0, 3).map((s) => s.p);
      }
      const result: PicturePage = { suggested, items: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: all.length };
      return ok(result);
    },
    true,
  ],
  [
    'POST',
    /^\/admin\/pictures$/,
    (request) => {
      const fileName = decodeURIComponent(request.headers['x-file-name'] ?? '').trim();
      if (classifyFile(fileName).kind !== 'photo') throw new HttpError(415, 'unsupported_file', 'Choose a photo (JPG or PNG).');
      const alt = (request.query.get('alt') ?? '').trim();
      if (!alt) throw invalid('Say what the photo shows, for people who cannot see it.', { alt: 'Describe the photo.' });
      // The mock cannot store the photo; it answers with a gallery drawing so the flow can continue.
      const stand = db.pictures[0];
      const picture = { id: newId('pic-own'), group: 'own' as const, url: stand ? stand.url : '/pictures/portals/primary.svg', alt };
      db.pictures.unshift(picture);
      return ok(picture, 201);
    },
    true,
  ],

  /* ---- admin: series and order ---- */
  [
    'GET',
    /^\/admin\/series\/([^/]+)$/,
    (_request, [seriesId = '']) => {
      const series = findSeries(seriesId);
      return ok({ ...toSeriesSummary(series), lessons: seriesLessons(series.id, true).map(toAdminLesson) });
    },
    true,
  ],
  [
    'POST',
    /^\/admin\/series$/,
    (request) => {
      const input = asObject(request.body) as Partial<NewSeries>;
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title) throw invalid('Give the series a name.', { title: 'Type a name.' });
      const group = findGroup(String(input.groupId ?? ''));
      if (group.portalId !== input.portalId) throw invalid('That group is not in the chosen portal.', { groupId: 'Choose the group again.' });
      const key = request.headers['idempotency-key'];
      if (key && db.idempotency[key]) {
        const existing = findSeries(db.idempotency[key] as string);
        return ok({ ...toSeriesSummary(existing), lessons: [] });
      }
      let id = `${group.id}-${slug(title)}`;
      if (db.series.some((s) => s.id === id)) id = newId(id);
      const series: SeriesRecord = { id, portalId: group.portalId, groupId: group.id, title, description: '', picture: null, availability: 'available', listenUrl: null };
      db.series.push(series);
      if (key) db.idempotency[key] = id;
      return ok({ ...toSeriesSummary(series), lessons: [] }, 201);
    },
    true,
  ],
  [
    'PUT',
    /^\/admin\/series\/([^/]+)\/order$/,
    (request, [seriesId = '']) => {
      const series = findSeries(seriesId);
      const input = asObject(request.body) as Partial<SeriesOrder>;
      const current = seriesLessons(series.id, true).filter((l) => l.type !== 'check');
      const ids = Array.isArray(input.lessonIds) ? input.lessonIds : [];
      const same = ids.length === current.length && current.every((l) => ids.indexOf(l.id) !== -1);
      if (!same) {
        throw new HttpError(409, 'conflict', 'The series changed while you were working. Open it again to see the newest order.');
      }
      ids.forEach((id, index) => {
        const lesson = findLesson(id);
        lesson.position = index + 1;
        if (lesson.placement) lesson.placement.position = index + 1;
        lesson.updatedAt = now();
      });
      return ok({ ...toSeriesSummary(series), lessons: seriesLessons(series.id, true).map(toAdminLesson) });
    },
    true,
  ],

  /* ---- admin: questions and Try it ---- */
  [
    'GET',
    /^\/admin\/lessons\/([^/]+)\/questions$/,
    (_request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      const content = lesson.content;
      if (content.type !== 'watch' && content.type !== 'check') throw new HttpError(409, 'wrong_type', 'Only Watch and Check lessons have questions.');
      const set: QuestionSet = { lessonId, kind: content.type === 'watch' ? 'video' : 'check', questions: content.questions };
      return ok(set);
    },
    true,
  ],
  [
    'PUT',
    /^\/admin\/lessons\/([^/]+)\/questions$/,
    (request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      const input = asObject(request.body) as Partial<QuestionSet>;
      const questions = Array.isArray(input.questions) ? input.questions : [];
      for (const q of questions) {
        if (!q.prompt || !q.prompt.trim()) throw invalid('Every question needs its words.', { prompt: 'Type the question.' });
        if (!q.answers || q.answers.length < 2) throw invalid('Every question needs at least two answers.', { answers: 'Add an answer.' });
        if (q.answers.filter((a) => a.correct).length !== 1) throw invalid('Choose one correct answer for every question.', { answers: 'Mark the correct answer.' });
      }
      if (lesson.content.type === 'watch') {
        const sorted = questions
          .map((q) => ({ ...q, atSeconds: q.atSeconds ?? 0, pauseUntilAnswered: q.pauseUntilAnswered ?? true }))
          .sort((a, b) => a.atSeconds - b.atSeconds);
        lesson.content = { ...lesson.content, questions: sorted };
        lesson.interactive = sorted.length > 0;
      } else if (lesson.content.type === 'check') {
        lesson.content = { type: 'check', questions };
      } else {
        throw new HttpError(409, 'wrong_type', 'Only Watch and Check lessons have questions.');
      }
      lesson.questionCount = questions.length;
      lesson.updatedAt = now();
      const set: QuestionSet = { lessonId, kind: lesson.content.type === 'watch' ? 'video' : 'check', questions: lesson.content.questions };
      return ok(set);
    },
    true,
  ],
  [
    'GET',
    /^\/admin\/lessons\/([^/]+)\/try-it$/,
    (_request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      if (lesson.content.type !== 'try') throw new HttpError(409, 'wrong_type', 'This is not a Try it lesson.');
      const content = lesson.content;
      const setup: TryItSetup =
        content.mode === 'package'
          ? { lessonId, mode: 'package', uploadId: null, packageUrl: content.packageUrl, checks: packageChecks('animation', 18 * 1024 * 1024) }
          : { lessonId, mode: 'hotspots', instruction: content.instruction, scene: content.scene, spots: content.spots, goal: content.goal, finishMessage: content.finishMessage, gentleMovement: content.gentleMovement };
      return ok(setup);
    },
    true,
  ],
  [
    'PUT',
    /^\/admin\/lessons\/([^/]+)\/try-it$/,
    (request, [lessonId = '']) => {
      const lesson = findLesson(lessonId);
      if (lesson.content.type !== 'try') throw new HttpError(409, 'wrong_type', 'This is not a Try it lesson.');
      const setup = asObject(request.body) as unknown as TryItSetup;
      if (setup.mode === 'package') {
        lesson.content = { type: 'try', mode: 'package', packageUrl: setup.packageUrl ?? SAMPLE_PACKAGE };
      } else if (setup.mode === 'hotspots') {
        if (!setup.scene) throw invalid('Add the scene picture first.', { scene: 'Upload a picture.' });
        if (setup.spots.length === 0) throw invalid('Add at least one spot for learners to tap.', { spots: 'Add a spot.' });
        lesson.content = {
          type: 'try',
          mode: 'hotspots',
          instruction: setup.instruction,
          scene: setup.scene,
          spots: setup.spots.map((spot) => ({ id: spot.id, label: spot.label, role: spot.role, says: spot.says, audioUrl: spot.audioUrl, portrait: spot.portrait, x: spot.x, y: spot.y, r: spot.r })),
          goal: setup.goal,
          finishMessage: setup.finishMessage,
          gentleMovement: setup.gentleMovement,
        };
      } else {
        throw invalid('Choose how to make the Try it lesson.', { mode: 'Choose package or picture.' });
      }
      lesson.updatedAt = now();
      return ok(setup);
    },
    true,
  ],
];

/* ------------------------------------------------------------------ */
/* entry                                                               */
/* ------------------------------------------------------------------ */

export async function handleMockRequest(request: MockRequest): Promise<MockResponse> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (request.path.indexOf(BASE) !== 0) {
    return { status: 404, body: errorBody('not_found', 'Unknown API path.') };
  }
  const path = request.path.slice(BASE.length) || '/';

  // Development helpers, not part of the contract.
  if (path === '/__mock/reset' && request.method === 'POST') {
    resetMockDb();
    return noContent();
  }
  if (path === '/__mock/delay' && request.method === 'POST') {
    mockControls.setDelay(Number(asObjectOrEmpty(request.body).ms ?? 0));
    return noContent();
  }
  if (path === '/__mock/fail-next' && request.method === 'POST') {
    const input = asObjectOrEmpty(request.body);
    mockControls.failNext(Number(input.status ?? 500), Number(input.count ?? 1));
    return noContent();
  }

  if (failNext && failNext.count > 0) {
    const status = failNext.status;
    failNext.count -= 1;
    if (failNext.count === 0) failNext = null;
    return { status, body: errorBody('mock_failure', 'The mock was told to fail this request.') };
  }

  let pathMatched = false;
  for (const [method, pattern, handler, admin] of routes) {
    const match = pattern.exec(path);
    if (!match) continue;
    pathMatched = true;
    if (method !== request.method) continue;
    try {
      if (admin) requireAdmin(request);
      return handler(request, match.slice(1).map(decodeURIComponent));
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, body: errorBody(error.code, error.message, error.fields) };
      throw error;
    }
  }
  return pathMatched
    ? { status: 405, body: errorBody('method_not_allowed', 'This action is not available here.') }
    : { status: 404, body: errorBody('not_found', 'Unknown API path.') };
}

function asObjectOrEmpty(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}
