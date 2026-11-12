import type { ProgressState } from '../api/types';
import { IconClock, IconFinished, IconNotStarted } from '../icons';
import { cx } from './cx';

/** Just the bar. Prefer <Progress>, which puts the words first. */
export function ProgressTrack({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  return (
    <span className="sb-progress__track" role="img" aria-label={label}>
      <span className="sb-progress__fill" style={{ width: `${percent}%` }} />
    </span>
  );
}

export interface ProgressProps {
  done: number;
  total: number;
  /** Overrides the words. Default: "1 of 5 done", "Not started", "Finished · all done". */
  words?: string;
  className?: string;
}

/** Progress · words first, then the bar. The state has an icon as well as a colour. */
export function Progress({ done, total, words, className }: ProgressProps) {
  const state: ProgressState = done <= 0 ? 'not-started' : done >= total ? 'finished' : 'started';
  const text = words ?? (state === 'not-started' ? 'Not started' : state === 'finished' ? 'Finished · all done' : `${done} of ${total} done`);
  const Glyph = state === 'finished' ? IconFinished : state === 'started' ? IconClock : IconNotStarted;
  return (
    <div className={cx('sb-progress', `sb-progress--${state}`, className)}>
      <p className="sb-progress__words">
        <Glyph size={28} />
        {text}
      </p>
      <ProgressTrack done={done} total={total} label={text} />
    </div>
  );
}

export interface ProgressStepsProps {
  /** One state per lesson, in order. */
  states: readonly ProgressState[];
  /** Read out instead of the bar, e.g. "Lesson 1 finished. Lesson 2 started. Lessons 3 and 4 not started." */
  label: string;
  className?: string;
}

/** One segment per lesson (the "You finished 1 of 4 lessons" panel). */
export function ProgressSteps({ states, label, className }: ProgressStepsProps) {
  return (
    <div className={cx('sb-steps', className)} role="img" aria-label={label}>
      {states.map((state, index) => (
        <span key={index} className={cx('sb-steps__step', state !== 'not-started' && `sb-steps__step--${state}`)} />
      ))}
    </div>
  );
}

/** "1 finished · 1 started · 2 to go" */
export function summariseStates(states: readonly ProgressState[]): string {
  const finished = states.filter((s) => s === 'finished').length;
  const started = states.filter((s) => s === 'started').length;
  const toGo = states.length - finished - started;
  return `${finished} finished · ${started} started · ${toGo} to go`;
}
