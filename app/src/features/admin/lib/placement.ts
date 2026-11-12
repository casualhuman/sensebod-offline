/*
 * "Where does it go?" as pure functions: portal → class / audience / topic →
 * series → position. The screens (ADM-M-Place, ADM-Add-3) only hold the
 * choices; everything that can be worked out from them lives here so it can
 * be tested without a browser.
 */
import type { AdminLesson, GroupKind, LessonType, Placement, PortalId } from '@shared/api';

export interface PlacementChoice {
  portalId: PortalId | null;
  groupId: string | null;
  seriesId: string | null;
  /** 1-based lesson number, or null until a series is chosen. */
  position: number | null;
}

export const EMPTY_CHOICE: PlacementChoice = { portalId: null, groupId: null, seriesId: null, position: null };

/** Choosing a portal clears what was chosen under the old one, and so on down. */
export function choosePortal(choice: PlacementChoice, portalId: PortalId): PlacementChoice {
  if (choice.portalId === portalId) return choice;
  return { portalId, groupId: null, seriesId: null, position: null };
}

export function chooseGroup(choice: PlacementChoice, groupId: string): PlacementChoice {
  if (choice.groupId === groupId) return choice;
  return { ...choice, groupId, seriesId: null, position: null };
}

export function chooseSeries(choice: PlacementChoice, seriesId: string): PlacementChoice {
  if (choice.seriesId === seriesId) return choice;
  return { ...choice, seriesId, position: null };
}

/** The second question changes with the portal. */
export function groupQuestion(kind: GroupKind | null): { title: string; hint: string; noun: string } {
  if (kind === 'class') return { title: 'Which class?', hint: 'Choose the class it is for.', noun: 'class' };
  if (kind === 'topic') return { title: 'Which topic?', hint: 'Choose the topic it belongs to.', noun: 'topic' };
  return { title: 'Who is it for?', hint: 'Choose the group it is for.', noun: 'group' };
}

/** The lessons of a series that take a number: everything except the Check quiz, in order. */
export function numberedLessons(lessons: readonly AdminLesson[]): AdminLesson[] {
  return lessons.filter((lesson) => lesson.type !== 'check');
}

/**
 * How many positions the lesson can take in the series: one more than the
 * lessons already there, unless it is already one of them.
 */
export function positionCount(seriesLessons: readonly AdminLesson[], lessonId: string): number {
  const numbered = numberedLessons(seriesLessons);
  const alreadyThere = numbered.some((lesson) => lesson.id === lessonId);
  return alreadyThere ? numbered.length : numbered.length + 1;
}

/** Where the lesson sits when nothing was chosen yet: where it already is, else at the end. */
export function defaultPosition(seriesLessons: readonly AdminLesson[], lessonId: string): number {
  const numbered = numberedLessons(seriesLessons);
  const index = numbered.findIndex((lesson) => lesson.id === lessonId);
  return index === -1 ? numbered.length + 1 : index + 1;
}

export function clampPosition(position: number, count: number): number {
  if (!isFinite(position)) return count;
  return Math.max(1, Math.min(count, Math.floor(position)));
}

export interface SeriesPreviewRow {
  id: string;
  /** null for the quiz, which is always last and has no number. */
  number: number | null;
  type: LessonType;
  title: string;
  /** The lesson being placed. */
  isNew: boolean;
}

/**
 * "How the series will look": the series with the lesson put at `position`,
 * the others moved down, the quiz kept last.
 */
export function previewSeries(
  seriesLessons: readonly AdminLesson[],
  placing: { id: string; type: LessonType; title: string },
  position: number,
): SeriesPreviewRow[] {
  const others = numberedLessons(seriesLessons).filter((lesson) => lesson.id !== placing.id);
  const index = clampPosition(position, others.length + 1) - 1;
  const rows: SeriesPreviewRow[] = others.map((lesson) => ({ id: lesson.id, number: 0, type: lesson.type, title: lesson.title, isNew: false }));
  if (placing.type !== 'check') rows.splice(index, 0, { id: placing.id, number: 0, type: placing.type, title: placing.title, isNew: true });
  rows.forEach((row, i) => {
    row.number = i + 1;
  });
  seriesLessons
    .filter((lesson) => lesson.type === 'check' && lesson.id !== placing.id)
    .forEach((quiz) => rows.push({ id: quiz.id, number: null, type: 'check', title: quiz.title, isNew: false }));
  if (placing.type === 'check') rows.push({ id: placing.id, number: null, type: 'check', title: placing.title, isNew: true });
  return rows;
}

/** "Place after Lesson 1", "First in the series". */
export function positionHint(position: number): string {
  return position <= 1 ? 'First in the series' : `Place after Lesson ${position - 1}`;
}

/** What is still missing, as the words for the "not ready" button, or null when ready. */
export function placementProblem(choice: PlacementChoice): string | null {
  if (!choice.portalId) return 'Choose a portal first';
  if (!choice.groupId) return 'Choose who it is for first';
  if (!choice.seriesId) return 'Choose a series first';
  if (!choice.position) return 'Choose the lesson number first';
  return null;
}

export function toPlacement(choice: PlacementChoice): Placement | null {
  if (!choice.portalId || !choice.groupId || !choice.seriesId || !choice.position) return null;
  return { portalId: choice.portalId, groupId: choice.groupId, seriesId: choice.seriesId, position: choice.position };
}

export function fromPlacement(placement: Placement | null): PlacementChoice {
  if (!placement) return EMPTY_CHOICE;
  return { portalId: placement.portalId, groupId: placement.groupId, seriesId: placement.seriesId, position: placement.position };
}

/** "4 lessons and a quiz", "1 lesson", "No lessons yet". */
export function seriesCountLabel(lessonCount: number, hasQuiz: boolean): string {
  if (lessonCount === 0) return hasQuiz ? 'A quiz, no lessons yet' : 'No lessons yet';
  const lessons = lessonCount === 1 ? '1 lesson' : `${lessonCount} lessons`;
  return hasQuiz ? `${lessons} and a quiz` : lessons;
}

/* ---- series order (ADM-Series) ---- */

/** Moves the item at `index` one place up (-1) or down (+1). Returns the same array when it cannot move. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): readonly T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = items.slice();
  const moved = next[index] as T;
  next[index] = next[target] as T;
  next[target] = moved;
  return next;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
