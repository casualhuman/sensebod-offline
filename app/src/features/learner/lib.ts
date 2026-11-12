/*
 * Small helpers shared by the learner browsing screens: where "Save my
 * progress" returns to, one-time notices, and the words built from data.
 */
import type { LessonType, PortalId } from '@shared/api';
import { paths } from '@shared/router';

export const CHILD_PROTECTION: PortalId = 'child-protection';

/** "Aminata Kamara" → "Aminata" (the chip says "Learning as Aminata"). */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}

/** "1 lesson", "4 lessons". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---- Save my progress: come back to the screen the learner was on ---- */

const RETURN_PARAM = 'from';

/**
 * Only paths inside this app are accepted, so a hand-made link cannot send a
 * learner anywhere else after saving their name.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.charAt(0) !== '/' || value.charAt(1) === '/' || value.indexOf('\\') !== -1) return paths.home();
  if (value.indexOf(paths.saveProgress()) === 0) return paths.home();
  return value;
}

/** Link to Save my progress that returns to `returnTo` afterwards. */
export function saveProgressPath(returnTo: string): string {
  const target = safeReturnTo(returnTo);
  return target === paths.home() ? paths.saveProgress() : `${paths.saveProgress()}?${RETURN_PARAM}=${encodeURIComponent(target)}`;
}

export function returnToFromQuery(query: URLSearchParams): string {
  return safeReturnTo(query.get(RETURN_PARAM));
}

/* ---- one-time notices, shown once on the next screen ---- */

export type LearnerNotice = { kind: 'saved'; name: string } | { kind: 'name-gone' };

let pendingNotice: LearnerNotice | null = null;

export function setLearnerNotice(notice: LearnerNotice | null): void {
  pendingNotice = notice;
}

export function peekLearnerNotice(): LearnerNotice | null {
  return pendingNotice;
}

/* ---- words ---- */

const TYPE_PHRASES: Record<LessonType, string> = {
  watch: 'watch a video',
  listen: 'listen',
  read: 'read',
  try: 'try it yourself',
  check: '',
};

/** "Watch a video, listen or try it yourself." built from the types in the list. */
export function describeLessonTypes(types: readonly LessonType[]): string {
  const phrases = types.map((type) => TYPE_PHRASES[type]).filter(Boolean);
  if (phrases.length === 0) return '';
  const last = phrases[phrases.length - 1] as string;
  const sentence = phrases.length === 1 ? last : `${phrases.slice(0, -1).join(', ')} or ${last}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** "Class 4" → ["Class", "4"]; a title without a number stays whole. */
export function splitClassTitle(title: string): { word: string; number: string } {
  const match = /^(.*\S)\s+(\S+)$/.exec(title.trim());
  if (!match || !/\d/.test(match[2] as string)) return { word: '', number: title };
  return { word: match[1] as string, number: match[2] as string };
}
