/*
 * Learner-side API calls. One function per endpoint in docs/API-CONTRACT.md.
 * Content answers are cached for a short while so Back navigation does not
 * ask the Pi again; progress is never cached.
 */
import { api, submitOnce, type RequestOptions } from './client';
import type {
  ContinueLesson,
  GroupDetail,
  Learner,
  LearnerProgress,
  Lesson,
  LessonProgress,
  LearnerSignIn,
  NewLearner,
  Portal,
  PortalDetail,
  PortalId,
  ProgressUpdate,
  SeriesDetail,
} from './types';

/** Content changes only when an admin publishes; a minute of reuse is safe. */
const CONTENT_CACHE_MS = 60000;

const content = (options?: RequestOptions): RequestOptions => ({ cacheMs: CONTENT_CACHE_MS, ...options });
const enc = encodeURIComponent;

export function getPortals(options?: RequestOptions): Promise<Portal[]> {
  return api.get('/portals', undefined, content(options));
}

export function getPortal(portalId: PortalId | string, options?: RequestOptions): Promise<PortalDetail> {
  return api.get(`/portals/${enc(portalId)}`, undefined, content(options));
}

export function getGroup(groupId: string, options?: RequestOptions): Promise<GroupDetail> {
  return api.get(`/groups/${enc(groupId)}`, undefined, content(options));
}

export function getSeries(seriesId: string, options?: RequestOptions): Promise<SeriesDetail> {
  return api.get(`/series/${enc(seriesId)}`, undefined, content(options));
}

export function getLesson(lessonId: string, options?: RequestOptions): Promise<Lesson> {
  return api.get(`/lessons/${enc(lessonId)}`, undefined, content(options));
}

/**
 * "Save and start learning". Safe to repeat: calling it again with the same
 * input (a double tap, "Try again" after a timeout) sends the same
 * Idempotency-Key, so the bag never makes two learners for one submission.
 * See `submitOnce` in ./client.ts for when the key is renewed.
 */
export function createLearner(input: NewLearner, options?: RequestOptions): Promise<Learner> {
  return submitOnce('/learners', input, options);
}

/**
 * "Sign in": finds the learner whose name and secret number match. 401 when
 * the name or the number is not right, 429 after too many wrong tries.
 */
export function signInLearner(input: LearnerSignIn, options?: RequestOptions): Promise<Learner> {
  return api.post('/learners/sign-in', input, options);
}

/** Checks a remembered learner still exists in this bag (404 if it was removed or the bag was reset). */
export function getLearner(learnerId: string, options?: RequestOptions): Promise<Learner> {
  return api.get(`/learners/${enc(learnerId)}`, undefined, options);
}

/** "Remove a name": deletes the learner and their progress from the bag. */
export function deleteLearner(learnerId: string, options?: RequestOptions): Promise<void> {
  return api.delete(`/learners/${enc(learnerId)}`, options);
}

export function getProgress(
  learnerId: string,
  filter?: { portalId?: string; seriesId?: string },
  options?: RequestOptions,
): Promise<LearnerProgress> {
  return api.get(`/learners/${enc(learnerId)}/progress`, filter, options);
}

/** Records where the learner is in one lesson. Idempotent (PUT): sending it twice is harmless. */
export function saveLessonProgress(
  learnerId: string,
  lessonId: string,
  update: ProgressUpdate,
  options?: RequestOptions,
): Promise<LessonProgress> {
  return api.put(`/learners/${enc(learnerId)}/progress/${enc(lessonId)}`, update, options);
}

/** The lesson for "Continue where you stopped" in a portal, or null. */
export function getContinueLesson(learnerId: string, portalId: string, options?: RequestOptions): Promise<ContinueLesson | null> {
  return api.get(`/learners/${enc(learnerId)}/continue`, { portalId }, options);
}
