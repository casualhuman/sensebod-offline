/*
 * The segmented "Lesson 2 of 4" bar (CPB-Video, AGB-Agri-Video): one segment
 * per lesson, at most five on screen. A long series (Agriculture has up to
 * 27 videos) shows the five around the current lesson, as AGB-Agri-Video
 * does for "Lesson 2 of 12".
 */
import type { LessonType, ProgressState } from '@shared/api';

/** finished: solid · begun: started earlier · now: the open lesson · todo: not started. */
export type StepLook = 'finished' | 'begun' | 'now' | 'todo';

export interface StepWindow {
  /** Lesson number of the first segment shown (1-based). */
  first: number;
  steps: StepLook[];
}

export const MAX_STEPS = 5;

export function seriesSteps(position: number, count: number, states: readonly ProgressState[], max = MAX_STEPS): StepWindow {
  const total = Math.max(count, position, 1);
  const size = Math.min(total, max);
  // Keep one earlier lesson in view where possible, and never run past the end.
  const first = Math.max(1, Math.min(position - 1, total - size + 1));
  const steps: StepLook[] = [];
  for (let number = first; number < first + size; number += 1) {
    if (number === position) steps.push('now');
    else {
      const state = states[number - 1];
      steps.push(state === 'finished' ? 'finished' : state === 'started' ? 'begun' : 'todo');
    }
  }
  return { first, steps };
}

const NOW_WORD: Record<LessonType, string> = {
  watch: 'Watching',
  listen: 'Listening to',
  read: 'Reading',
  try: 'Doing',
  check: 'Doing',
};

/** For screen readers: "Lesson 1 finished. Watching lesson 2 now. Lesson 3 not started." */
export function describeSteps(window: StepWindow, type: LessonType): string {
  return window.steps
    .map((look, index) => {
      const number = window.first + index;
      if (look === 'now') return `${NOW_WORD[type]} lesson ${number} now.`;
      if (look === 'finished') return `Lesson ${number} finished.`;
      if (look === 'begun') return `Lesson ${number} started.`;
      return `Lesson ${number} not started.`;
    })
    .join(' ');
}

const NOW_SHORT: Record<LessonType, string> = {
  watch: 'watching now',
  listen: 'listening now',
  read: 'reading now',
  try: 'doing this now',
  check: 'doing this now',
};

/** "1 finished · watching now · 2 to go" (the other lessons of the series, whole series, not only the five shown). */
export function summariseSeries(position: number, count: number, states: readonly ProgressState[], type: LessonType): string {
  let finished = 0;
  for (let number = 1; number <= count; number += 1) {
    if (number !== position && states[number - 1] === 'finished') finished += 1;
  }
  const toGo = Math.max(0, count - finished - 1);
  return `${finished} finished · ${NOW_SHORT[type]} · ${toGo} to go`;
}
