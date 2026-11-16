/*
 * catalog: reading the content tree and shaping it as openapi.yaml says.
 *
 * Every learner answer is built from one query per table (no N+1): the
 * groups, then the series of those groups, then the published lessons of
 * those series (SYSTEM-ARCHITECTURE §5.3).
 *
 * Type-specific lesson content lives in lesson.body_json (DATABASE §6.1);
 * files are tracked in lesson_asset → blob and turned into root-relative
 * /media/… URLs here. Shipped sample content may carry ready-made URLs in
 * body_json; assets, when present, win.
 */
import type { Db } from '../core/db.ts';
import { notFound } from '../core/errors.ts';

export type LessonType = 'watch' | 'listen' | 'read' | 'try' | 'check';

export interface Picture {
  url: string;
  alt: string;
}

export interface LessonRow {
  id: string;
  series_id: string | null;
  position: number | null;
  type: LessonType;
  interactive: number;
  captions: number;
  read_along: number;
  needs_sound: number;
  length_seconds: number | null;
  pages: number | null;
  title: string;
  summary: string;
  language: string;
  status: 'draft' | 'published';
  source: string;
  picture_id: string | null;
  listen_blob: string | null;
  file_names_json: string;
  body_json: string;
  version: number;
  created_at: string;
  updated_at: string;
  pic_url: string | null;
  pic_rel: string | null;
  pic_alt: string | null;
  listen_rel: string | null;
}

export interface SeriesRow {
  id: string;
  group_id: string;
  title: string;
  description: string;
  availability: string;
  icon: string | null;
  sort_order: number;
  pic_url: string | null;
  pic_rel: string | null;
  pic_alt: string | null;
  listen_rel: string | null;
}

export interface GroupRow {
  id: string;
  portal_id: string;
  kind: string;
  title: string;
  description: string;
  availability: string;
  icon: string | null;
  audience: string | null;
  sort_order: number;
  pic_url: string | null;
  pic_rel: string | null;
  pic_alt: string | null;
}

export interface PortalRow {
  id: string;
  title: string;
  description: string;
  theme: string;
  group_kind: string;
  sensitive: number;
  sort_order: number;
  pic_url: string | null;
  pic_rel: string | null;
  pic_alt: string | null;
  listen_rel: string | null;
}

export const mediaUrl = (relPath: string): string => `/media/${relPath}`;

const PIC = 'pc.url_path AS pic_url, pb.rel_path AS pic_rel, pc.alt AS pic_alt';
const picJoin = (alias: string): string => `LEFT JOIN picture pc ON pc.id = ${alias}.picture_id LEFT JOIN blob pb ON pb.sha256 = pc.blob_sha256`;
const listenJoin = (alias: string): string => `LEFT JOIN blob lb ON lb.sha256 = ${alias}.listen_blob`;

export const LESSON_SELECT = `SELECT l.*, ${PIC}, lb.rel_path AS listen_rel FROM lesson l ${picJoin('l')} ${listenJoin('l')}`;
const SERIES_SELECT = `SELECT s.id, s.group_id, s.title, s.description, s.availability, s.icon, s.sort_order, ${PIC}, lb.rel_path AS listen_rel FROM series s ${picJoin('s')} ${listenJoin('s')}`;
const GROUP_SELECT = `SELECT g.id, g.portal_id, g.kind, g.title, g.description, g.availability, g.icon, g.audience, g.sort_order, ${PIC} FROM content_group g ${picJoin('g')}`;
const PORTAL_SELECT = `SELECT p.id, p.title, p.description, p.theme, p.group_kind, p.sensitive, p.sort_order, ${PIC}, lb.rel_path AS listen_rel FROM portal p ${picJoin('p')} ${listenJoin('p')}`;

/** Learner order inside a series: numbered lessons 1..n, the Check quiz last. */
const LESSON_ORDER = 'l.series_id, l.position IS NULL, l.position';

export function pictureOf(row: { pic_url: string | null; pic_rel: string | null; pic_alt: string | null }): Picture | null {
  if (row.pic_url) return { url: row.pic_url, alt: row.pic_alt ?? '' };
  if (row.pic_rel) return { url: mediaUrl(row.pic_rel), alt: row.pic_alt ?? '' };
  return null;
}

export function parseBody(row: { body_json: string }): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.body_json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function summaryOf(row: LessonRow) {
  return {
    id: row.id,
    seriesId: row.series_id ?? '',
    position: row.position,
    title: row.title,
    summary: row.summary,
    picture: pictureOf(row),
    language: row.language,
    type: row.type,
    interactive: row.interactive === 1,
    captions: row.captions === 1,
    readAlong: row.read_along === 1,
    needsSound: row.needs_sound === 1,
    length: row.length_seconds,
    pages: row.pages,
  };
}

function bySeries(lessons: LessonRow[]): Map<string, LessonRow[]> {
  const map = new Map<string, LessonRow[]>();
  for (const lesson of lessons) {
    const key = lesson.series_id ?? '';
    const list = map.get(key);
    if (list) list.push(lesson);
    else map.set(key, [lesson]);
  }
  return map;
}

function seriesSummary(series: SeriesRow, portalId: string, lessons: LessonRow[]) {
  const quiz = lessons.find((l) => l.type === 'check');
  return {
    id: series.id,
    portalId,
    groupId: series.group_id,
    title: series.title,
    description: series.description,
    picture: pictureOf(series),
    availability: series.availability,
    lessonCount: lessons.filter((l) => l.type !== 'check').length,
    hasQuiz: quiz !== undefined,
    icon: series.icon,
    quiz: quiz ? summaryOf(quiz) : null,
  };
}

function groupBody(group: GroupRow, series: SeriesRow[], lessons: Map<string, LessonRow[]>) {
  const numbered = series.flatMap((s) => lessons.get(s.id) ?? []).filter((l) => l.type !== 'check');
  const types: LessonType[] = [];
  for (const lesson of numbered) if (types.indexOf(lesson.type) === -1) types.push(lesson.type);
  const only = series.length === 1 ? (series[0] as SeriesRow) : null;
  const onlyQuiz = only ? (lessons.get(only.id) ?? []).find((l) => l.type === 'check') : undefined;
  return {
    id: group.id,
    portalId: group.portal_id,
    kind: group.kind,
    title: group.title,
    description: group.description,
    picture: pictureOf(group),
    availability: group.availability,
    lessonCount: numbered.length,
    lessonTypes: types,
    seriesCount: series.length,
    onlySeriesId: only ? only.id : null,
    icon: group.icon,
    audience: group.audience,
    quiz: onlyQuiz ? summaryOf(onlyQuiz) : null,
  };
}

function portalBody(portal: PortalRow) {
  return {
    id: portal.id,
    title: portal.title,
    description: portal.description,
    theme: portal.theme,
    groupKind: portal.group_kind,
    picture: pictureOf(portal),
    listenUrl: portal.listen_rel ? mediaUrl(portal.listen_rel) : null,
  };
}

const portalRef = (portal: PortalRow) => ({ id: portal.id, title: portal.title, theme: portal.theme, groupKind: portal.group_kind });

export function getPortalRow(db: Db, id: string): PortalRow | undefined {
  return db.get<PortalRow>(`${PORTAL_SELECT} WHERE p.id = ?`, id);
}

export function listPortals(db: Db) {
  return db.all<PortalRow>(`${PORTAL_SELECT} ORDER BY p.sort_order`).map(portalBody);
}

export function portalDetail(db: Db, portalId: string) {
  const portal = getPortalRow(db, portalId);
  if (!portal) throw notFound('This portal');
  const groups = db.all<GroupRow>(`${GROUP_SELECT} WHERE g.portal_id = ? ORDER BY g.sort_order, g.id`, portalId);
  const series = db.all<SeriesRow>(`${SERIES_SELECT} WHERE s.group_id IN (SELECT id FROM content_group WHERE portal_id = ?) ORDER BY s.sort_order, s.id`, portalId);
  const lessons = bySeries(
    db.all<LessonRow>(
      `${LESSON_SELECT} WHERE l.status = 'published' AND l.series_id IN (SELECT s.id FROM series s JOIN content_group g ON g.id = s.group_id WHERE g.portal_id = ?) ORDER BY ${LESSON_ORDER}`,
      portalId,
    ),
  );
  return {
    ...portalBody(portal),
    groups: groups.map((group) =>
      groupBody(
        group,
        series.filter((s) => s.group_id === group.id),
        lessons,
      ),
    ),
  };
}

export function groupDetail(db: Db, groupId: string) {
  const group = db.get<GroupRow>(`${GROUP_SELECT} WHERE g.id = ?`, groupId);
  if (!group) throw notFound('This group');
  const portal = getPortalRow(db, group.portal_id) as PortalRow;
  const series = db.all<SeriesRow>(`${SERIES_SELECT} WHERE s.group_id = ? ORDER BY s.sort_order, s.id`, groupId);
  const lessons = bySeries(
    db.all<LessonRow>(`${LESSON_SELECT} WHERE l.status = 'published' AND l.series_id IN (SELECT id FROM series WHERE group_id = ?) ORDER BY ${LESSON_ORDER}`, groupId),
  );
  return {
    ...groupBody(group, series, lessons),
    portal: portalRef(portal),
    series: series.map((s) => seriesSummary(s, group.portal_id, lessons.get(s.id) ?? [])),
  };
}

export interface SeriesContext {
  series: SeriesRow;
  group: GroupRow;
  portal: PortalRow;
}

export function seriesContext(db: Db, seriesId: string): SeriesContext | null {
  const series = db.get<SeriesRow>(`${SERIES_SELECT} WHERE s.id = ?`, seriesId);
  if (!series) return null;
  const group = db.get<GroupRow>(`${GROUP_SELECT} WHERE g.id = ?`, series.group_id) as GroupRow;
  const portal = getPortalRow(db, group.portal_id) as PortalRow;
  return { series, group, portal };
}

export function seriesLessons(db: Db, seriesId: string, includeDrafts: boolean): LessonRow[] {
  return db.all<LessonRow>(`${LESSON_SELECT} WHERE l.series_id = ? ${includeDrafts ? '' : "AND l.status = 'published'"} ORDER BY ${LESSON_ORDER}`, seriesId);
}

export function seriesDetail(db: Db, seriesId: string) {
  const context = seriesContext(db, seriesId);
  if (!context) throw notFound('This series');
  const lessons = seriesLessons(db, seriesId, false);
  return {
    ...seriesSummary(context.series, context.portal.id, lessons),
    portal: portalRef(context.portal),
    group: {
      id: context.group.id,
      title: context.group.title,
      kind: context.group.kind,
      seriesCount: Number(db.value('SELECT count(*) FROM series WHERE group_id = ?', context.group.id) ?? 0),
    },
    lessons: lessons.map(summaryOf),
    listenUrl: context.series.listen_rel ? mediaUrl(context.series.listen_rel) : null,
  };
}

export function adminSeries(db: Db, seriesId: string) {
  const context = seriesContext(db, seriesId);
  if (!context) throw notFound('This series');
  return {
    ...seriesSummary(context.series, context.portal.id, seriesLessons(db, seriesId, false)),
    lessons: adminLessonsWhere(db, 'l.series_id = ?', [seriesId], `ORDER BY ${LESSON_ORDER}`),
  };
}

/* ------------------------------------------------------------------ */
/* lesson content                                                      */
/* ------------------------------------------------------------------ */

interface AssetRow {
  role: string;
  ordinal: number;
  language: string | null;
  label: string | null;
  rel_path: string;
  mime_type: string;
}

function assetsOf(db: Db, lessonId: string): AssetRow[] {
  return db.all<AssetRow>(
    'SELECT a.role, a.ordinal, a.language, a.label, b.rel_path, b.mime_type FROM lesson_asset a JOIN blob b ON b.sha256 = a.blob_sha256 WHERE a.lesson_id = ? ORDER BY a.role, a.ordinal',
    lessonId,
  );
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const source = (asset: AssetRow) => ({ url: mediaUrl(asset.rel_path), mimeType: asset.mime_type });
const picture = (asset: AssetRow, fallbackAlt: string): Picture => ({ url: mediaUrl(asset.rel_path), alt: asset.label ?? fallbackAlt });

/** The learner-side `content` of a lesson, by type. */
export function contentOf(db: Db, row: LessonRow): Record<string, unknown> {
  const body = parseBody(row);
  const assets = assetsOf(db, row.id);
  const of = (role: string): AssetRow[] => assets.filter((a) => a.role === role);
  const first = (role: string): AssetRow | undefined => of(role)[0];
  // The smaller copy comes first: an old phone takes the first source it can play.
  const sources = [...of('smaller'), ...of('source')].map(source);
  const audio = of('audio').map(source);
  if (row.type === 'watch') {
    const poster = first('poster');
    return {
      type: 'watch',
      sources: sources.length > 0 ? sources : asArray(body.sources),
      poster: poster ? picture(poster, row.title) : (body.poster ?? null),
      captions: of('caption').length > 0 ? of('caption').map((c) => ({ language: c.language ?? 'en', label: c.label ?? 'English', url: mediaUrl(c.rel_path) })) : asArray(body.captions),
      questions: asArray(body.questions),
      learningPoints: asArray(body.learningPoints),
    };
  }
  if (row.type === 'listen') {
    const cover = first('cover');
    const all = [...audio, ...sources];
    return {
      type: 'listen',
      sources: all.length > 0 ? all : asArray(body.sources),
      cover: cover ? picture(cover, row.title) : (body.cover ?? null),
      transcript: asArray(body.transcript),
    };
  }
  if (row.type === 'read') {
    const pages = of('page_image');
    const cover = first('cover');
    return {
      type: 'read',
      blocks: asArray(body.blocks),
      pageImages: pages.length > 0 ? pages.map((p, index) => picture(p, `Page ${index + 1}`)) : asArray(body.pageImages),
      audio: audio[0] ?? body.audio ?? null,
      cover: cover ? picture(cover, row.title) : (body.cover ?? null),
    };
  }
  if (row.type === 'try') {
    if (body.mode === 'hotspots') {
      return {
        type: 'try',
        mode: 'hotspots',
        instruction: body.instruction ?? '',
        scene: body.scene ?? null,
        spots: asArray(body.spots),
        goal: body.goal === 'any' ? 'any' : 'all',
        finishMessage: body.finishMessage ?? '',
        gentleMovement: body.gentleMovement === true,
      };
    }
    return { type: 'try', mode: 'package', packageUrl: typeof body.packageUrl === 'string' ? body.packageUrl : '' };
  }
  return { type: 'check', questions: asArray(body.questions) };
}

/** `GET /lessons/{id}`: a published, placed lesson with its content and what comes next. */
export function lessonDetail(db: Db, lessonId: string) {
  const row = db.get<LessonRow>(`${LESSON_SELECT} WHERE l.id = ?`, lessonId);
  if (!row || row.status !== 'published' || row.series_id === null) throw notFound('This lesson');
  const context = seriesContext(db, row.series_id) as SeriesContext;
  const inSeries = seriesLessons(db, row.series_id, false);
  const next = inSeries[inSeries.findIndex((l) => l.id === row.id) + 1];
  const body = parseBody(row);
  return {
    ...summaryOf(row),
    portal: portalRef(context.portal),
    group: { id: context.group.id, title: context.group.title, kind: context.group.kind },
    series: { id: context.series.id, title: context.series.title, lessonCount: inSeries.filter((l) => l.type !== 'check').length },
    next: next ? summaryOf(next) : null,
    listenUrl: row.listen_rel ? mediaUrl(row.listen_rel) : typeof body.listenUrl === 'string' ? body.listenUrl : null,
    content: contentOf(db, row),
  };
}

/* ------------------------------------------------------------------ */
/* admin view of lessons                                               */
/* ------------------------------------------------------------------ */

interface AdminRow extends LessonRow {
  a_series_title: string | null;
  a_group_id: string | null;
  a_group_title: string | null;
  a_portal_id: string | null;
  a_portal_title: string | null;
  a_numbered: number | null;
  a_missing: number;
  a_working: number;
}

const ADMIN_SELECT = `SELECT l.*, ${PIC}, lb.rel_path AS listen_rel,
    s.title AS a_series_title, g.id AS a_group_id, g.title AS a_group_title, p.id AS a_portal_id, p.title AS a_portal_title,
    (SELECT count(*) FROM lesson n WHERE n.series_id = l.series_id AND n.position IS NOT NULL) AS a_numbered,
    0 AS a_missing,
    (SELECT count(*) FROM upload u WHERE u.state IN ('receiving','processing') AND u.id IN (SELECT value FROM json_each(l.body_json, '$.uploadIds'))) AS a_working
  FROM lesson l ${picJoin('l')} ${listenJoin('l')}
  LEFT JOIN series s ON s.id = l.series_id
  LEFT JOIN content_group g ON g.id = s.group_id
  LEFT JOIN portal p ON p.id = g.portal_id`;

export const ADMIN_FROM = `FROM lesson l
  LEFT JOIN series s ON s.id = l.series_id
  LEFT JOIN content_group g ON g.id = s.group_id
  LEFT JOIN portal p ON p.id = g.portal_id`;

/** Library order: portal, group, series, position; lessons waiting to be placed last. */
export const ADMIN_ORDER = 'ORDER BY l.series_id IS NULL, p.sort_order, g.sort_order, s.sort_order, s.id, l.position IS NULL, l.position, l.updated_at DESC, l.id';

function adminBody(row: AdminRow) {
  const body = parseBody(row);
  const questions = asArray(body.questions).length;
  const placed = row.series_id !== null && row.a_portal_id !== null && row.a_group_id !== null;
  const notes: string[] = [];
  if (row.type === 'listen' && asArray(body.transcript).length === 0) notes.push('Read along text not added. It helps learners who cannot hear well.');
  if (row.a_working > 0) notes.push('The bag is still getting the file ready.');
  if (typeof body.mediaNote === 'string') notes.push(body.mediaNote);
  let fileNames: string[] = [];
  try {
    fileNames = (JSON.parse(row.file_names_json) as unknown[]).filter((n): n is string => typeof n === 'string');
  } catch {
    fileNames = [];
  }
  return {
    ...summaryOf(row),
    status: row.status,
    placement: placed
      ? { portalId: row.a_portal_id as string, groupId: row.a_group_id as string, seriesId: row.series_id as string, position: row.position ?? (row.a_numbered ?? 0) + 1 }
      : null,
    placementLabel: placed ? `${row.a_portal_title} → ${row.a_group_title} → ${row.a_series_title}` : null,
    source: row.source,
    fileNames,
    questionCount: row.type === 'check' ? questions : row.type === 'watch' && questions > 0 ? questions : null,
    pictureId: row.picture_id,
    updatedAt: row.updated_at,
    notes,
    version: row.version,
  };
}

export function adminLessonsWhere(db: Db, where: string, params: (string | number)[], tail: string) {
  return db.all<AdminRow>(`${ADMIN_SELECT} WHERE ${where} ${tail}`, ...params).map(adminBody);
}

export function adminLesson(db: Db, lessonId: string) {
  const found = adminLessonsWhere(db, 'l.id = ?', [lessonId], '')[0];
  if (!found) throw notFound('This lesson');
  return found;
}

/** Ids of lessons in sensitive portals: never written to a log (SYSTEM-ARCHITECTURE §12.3). */
export function sensitiveLessonIds(db: Db): string[] {
  return db
    .all<{ id: string }>("SELECT l.id FROM lesson l JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id WHERE p.sensitive = 1")
    .map((r) => r.id);
}

/** Is this series in a portal where Child protection rules apply? */
export function seriesIsSensitive(db: Db, seriesId: string): boolean {
  return db.value('SELECT p.sensitive FROM series s JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id WHERE s.id = ?', seriesId) === 1;
}
