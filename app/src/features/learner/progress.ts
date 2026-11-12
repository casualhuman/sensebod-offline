/*
 * Progress for the learner who is saving their progress on this phone.
 * A guest has none: nothing is asked of the bag and every state reads
 * "Not started". Progress is never cached, so coming back from a lesson
 * shows the new state.
 */
import { useEffect, useMemo } from 'react';
import { learnerApi, useApi, type ApiError, type ContinueLesson, type LessonProgress, type ProgressState } from '@shared/api';
import type { ChipState } from '@shared/components';
import { forgetLearner, useSession } from '@shared/session';
import { setLearnerNotice } from './lib';

export interface SeriesCount {
  started: number;
  finished: number;
}

export interface ProgressIndex {
  byLesson: Map<string, ProgressState>;
  bySeries: Map<string, SeriesCount>;
}

export function indexProgress(lessons: readonly LessonProgress[]): ProgressIndex {
  const byLesson = new Map<string, ProgressState>();
  const bySeries = new Map<string, SeriesCount>();
  for (const entry of lessons) {
    if (entry.state === 'not-started') continue;
    byLesson.set(entry.lessonId, entry.state);
    const counts = bySeries.get(entry.seriesId) ?? { started: 0, finished: 0 };
    if (entry.state === 'finished') counts.finished += 1;
    else counts.started += 1;
    bySeries.set(entry.seriesId, counts);
  }
  return { byLesson, bySeries };
}

export interface ProgressResult {
  /** null for a guest, and while the first answer is on its way. */
  index: ProgressIndex | null;
  /** True when someone is saving progress on this phone. */
  saving: boolean;
  /** Set when the progress could not be loaded; the lessons still show. */
  error: ApiError | null;
  reload: () => void;
}

/** The name was removed from the bag (or the bag was reset): stop using it on this phone. */
function useForgetMissingLearner(learnerId: string | null, error: ApiError | null): void {
  const gone = Boolean(learnerId && error && error.status === 404);
  useEffect(() => {
    if (!gone || !learnerId) return;
    setLearnerNotice({ kind: 'name-gone' });
    forgetLearner(learnerId);
  }, [gone, learnerId]);
}

export function useProgress(filter: { portalId?: string; seriesId?: string }): ProgressResult {
  const { learner } = useSession();
  const learnerId = learner ? learner.id : null;
  const { portalId, seriesId } = filter;
  const { data, error, reload } = useApi(
    (signal) => (learnerId ? learnerApi.getProgress(learnerId, { portalId, seriesId }, { signal }) : Promise.resolve(null)),
    [learnerId, portalId, seriesId],
  );
  useForgetMissingLearner(learnerId, error);
  const index = useMemo(() => (data ? indexProgress(data.lessons) : null), [data]);
  return { index, saving: learnerId !== null, error: error && error.status !== 404 ? error : null, reload };
}

/** "Continue where you stopped" for a portal; null for a guest or when nothing is started. */
export function useContinueLesson(portalId: string, enabled = true): ContinueLesson | null {
  const { learner } = useSession();
  const learnerId = enabled && learner ? learner.id : null;
  // A failure here only hides the shortcut: the topics below still work.
  const { data } = useApi(
    (signal) => (learnerId ? learnerApi.getContinueLesson(learnerId, portalId, { signal }) : Promise.resolve(null)),
    [learnerId, portalId],
  );
  return data ?? null;
}

export function lessonState(index: ProgressIndex | null, lessonId: string): ProgressState {
  return (index && index.byLesson.get(lessonId)) || 'not-started';
}

export interface ListProgress {
  state: ChipState;
  /** Lessons finished, never more than `total`. */
  done: number;
  total: number;
}

/**
 * State of a subject or topic card from the progress of one series.
 * `total` leaves the Check quiz out (the contract's lessonCount), while the
 * progress list may include a finished quiz, so `done` is capped.
 */
export function listProgress(index: ProgressIndex | null, seriesId: string | null, total: number, available: boolean): ListProgress {
  if (!available) return { state: 'not-in-bag', done: 0, total };
  const counts = index && seriesId ? index.bySeries.get(seriesId) : undefined;
  if (!counts || total <= 0) return { state: 'not-started', done: 0, total };
  const done = Math.min(counts.finished, total);
  if (done >= total) return { state: 'finished', done, total };
  return { state: 'started', done, total };
}
