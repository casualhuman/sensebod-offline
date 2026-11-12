/*
 * Progress for the lesson screens. Progress lives in the bag (the API), and
 * only when "Save my progress" is on: a guest has no learner id and nothing
 * is sent or stored for them.
 *
 * What is sent, and when (no polling, no timers):
 *   - `started`   once, when a lesson opens
 *   - a position  when a video or audio is paused or left
 *   - `finished`  when the learner reaches the end; quiz results go with it
 */
import { useSyncExternalStore } from 'react';
import { describeError, learnerApi, useApi, type Lesson, type LessonProgress, type ProgressState } from '@shared/api';
import { getSession, useSession } from '@shared/session';

export interface QuizResult {
  correct: number;
  total: number;
  /** One entry per question, in order: did the learner end on the right answer? */
  answers: boolean[];
}

/** guest: nothing to save · saving · saved · failed (with a way to try again). */
export type SaveStatus = 'guest' | 'saving' | 'saved' | 'failed';

export interface FinishRecord {
  lessonId: string;
  status: SaveStatus;
  /** Who it was saved for ("Saved for Aminata"). */
  learnerName: string | null;
  result: QuizResult | null;
  /** Plain sentence when saving failed. */
  problem: string | null;
}

/*
 * The last lesson finished in this visit. One record only (never a growing
 * list): the finished screen reads it to show the quiz result and whether
 * the progress was saved. After a page refresh it is gone, and the finished
 * screen asks the bag instead.
 */
let record: FinishRecord | null = null;
const listeners = new Set<() => void>();

function setRecord(next: FinishRecord | null): void {
  record = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getRecord(): FinishRecord | null {
  return record;
}

/** The finish record for this lesson, if it was finished in this visit. */
export function useFinishRecord(lessonId: string): FinishRecord | null {
  const current = useSyncExternalStore(subscribe, getRecord);
  return current && current.lessonId === lessonId ? current : null;
}

function send(lessonId: string, learnerId: string, result: QuizResult | null): void {
  learnerApi
    .saveLessonProgress(learnerId, lessonId, result ? { state: 'finished', correct: result.correct, total: result.total } : { state: 'finished' })
    .then(
      () => {
        if (record && record.lessonId === lessonId) setRecord({ ...record, status: 'saved', problem: null });
      },
      (error: unknown) => {
        if (record && record.lessonId === lessonId) setRecord({ ...record, status: 'failed', problem: describeError(error) });
      },
    );
}

/**
 * The learner reached the end of a lesson. Remembers the result for the
 * finished screen and, when a learner is signed in on this phone, saves it
 * in the bag. Safe to call twice (the request is an idempotent PUT).
 */
export function finishLesson(lessonId: string, result: QuizResult | null = null): void {
  const { learner } = getSession();
  if (!learner) {
    setRecord({ lessonId, status: 'guest', learnerName: null, result, problem: null });
    return;
  }
  setRecord({ lessonId, status: 'saving', learnerName: learner.name, result, problem: null });
  send(lessonId, learner.id, result);
}

/** "Try again" after a failed save. */
export function retryFinish(lessonId: string): void {
  if (record && record.lessonId === lessonId) finishLesson(lessonId, record.result);
  else finishLesson(lessonId);
}

/** A lesson was opened. The bag never downgrades a finished lesson, so this is always safe. */
export function markStarted(lessonId: string): void {
  const { learner } = getSession();
  if (!learner) return;
  // Not being able to record "started" must never get in the way of the lesson.
  learnerApi.saveLessonProgress(learner.id, lessonId, { state: 'started' }).catch(() => undefined);
}

let lastPlace = '';

/** Where a video or audio stopped, so it can carry on from there next time. */
export function savePosition(lessonId: string, seconds: number): void {
  const { learner } = getSession();
  if (!learner || !isFinite(seconds) || seconds < 1) return;
  const place = `${learner.id}|${lessonId}|${Math.floor(seconds)}`;
  // Pausing and then leaving reports the same place twice: send it once.
  if (place === lastPlace) return;
  lastPlace = place;
  learnerApi.saveLessonProgress(learner.id, lessonId, { state: 'started', positionSeconds: Math.floor(seconds) }).catch(() => undefined);
}

/** Tests only. */
export function resetFinishRecordForTests(): void {
  record = null;
}

export interface SeriesProgress {
  /** False for a guest, and until the answer arrives. */
  known: boolean;
  /** State of each numbered lesson of the series, by position (index 0 = Lesson 1). */
  states: ProgressState[];
  /** This lesson's own saved progress, if any. */
  own: LessonProgress | null;
}

const UNKNOWN: SeriesProgress = { known: false, states: [], own: null };

/**
 * What the learner has done in this lesson's series, for the "Lesson 2 of 4"
 * bar. A guest costs no request at all. A failure here is not shown: the
 * lesson still works, the bar just shows the current lesson only.
 */
export function useSeriesProgress(lesson: Pick<Lesson, 'id' | 'series'>): SeriesProgress {
  const { learner } = useSession();
  const learnerId = learner ? learner.id : null;
  const seriesId = lesson.series.id;
  const { data } = useApi<SeriesProgress>(
    (signal) => {
      if (!learnerId) return Promise.resolve(UNKNOWN);
      return Promise.all([learnerApi.getSeries(seriesId, { signal }), learnerApi.getProgress(learnerId, { seriesId }, { signal })]).then(([series, progress]) => {
        const byLesson: Record<string, LessonProgress> = {};
        progress.lessons.forEach((entry) => {
          byLesson[entry.lessonId] = entry;
        });
        const states: ProgressState[] = [];
        series.lessons.forEach((item) => {
          if (item.position === null) return;
          const entry = byLesson[item.id];
          states[item.position - 1] = entry ? entry.state : 'not-started';
        });
        for (let index = 0; index < states.length; index += 1) {
          if (!states[index]) states[index] = 'not-started';
        }
        return { known: true, states, own: byLesson[lesson.id] ?? null };
      });
    },
    [learnerId, seriesId, lesson.id],
  );
  return data ?? UNKNOWN;
}
