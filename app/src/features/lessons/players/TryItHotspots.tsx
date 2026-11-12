/*
 * Try it · tap the picture (CPB-TryIt "Who can I tell?", CPB-TryIt-Tab).
 * A scene with tappable spots; each one answers in a speech card, and with
 * a recorded voice when there is one. Everything comes from the lesson data.
 */
import { useEffect, useRef, useState } from 'react';
import type { Lesson, TryItContent, TryItSpot } from '@shared/api';
import { Button, ButtonLink, cx, Illustration, LessonTypeIcon } from '@shared/components';
import { IconArrowRight, IconBack, IconInfo, IconTick, IconTryAgain, IconTryIt } from '@shared/icons';
import { paths } from '@shared/router';
import { startListening, stopListening } from '@shared/shell';
import { SaveNote } from '../parts/Finished';
import { nextLabel, seriesPath } from '../parts/LessonParts';
import { finishLesson } from '../progress/progress';

export type HotspotContent = Extract<TryItContent, { mode: 'hotspots' }>;

export interface HotspotState {
  found: boolean[];
  /** The spot whose words are showing, or -1. */
  current: number;
}

export function freshHotspots(count: number): HotspotState {
  const found: boolean[] = [];
  for (let index = 0; index < count; index += 1) found.push(false);
  return { found, current: -1 };
}

export function tapSpot(state: HotspotState, index: number): HotspotState {
  if (index < 0 || index >= state.found.length) return state;
  return { found: state.found.map((value, at) => (at === index ? true : value)), current: index };
}

/** "Next person": the next spot not found yet, going round; when all are found, simply the next one. */
export function nextSpot(state: HotspotState): number {
  const count = state.found.length;
  if (count === 0) return -1;
  for (let step = 1; step <= count; step += 1) {
    const candidate = (state.current + step + count) % count;
    if (!state.found[candidate]) return candidate;
  }
  return (state.current + 1 + count) % count;
}

export function foundCount(state: HotspotState): number {
  return state.found.filter(Boolean).length;
}

/** goal "all": every spot · goal "any": one is enough. */
export function isComplete(state: HotspotState, goal: 'all' | 'any'): boolean {
  const count = foundCount(state);
  if (state.found.length === 0) return false;
  return goal === 'any' ? count >= 1 : count === state.found.length;
}

function Spot({ spot, number, found, current, onTap }: { spot: TryItSpot; number: number; found: boolean; current: boolean; onTap: () => void }) {
  const state = current ? 'Showing now.' : found ? 'Found.' : 'Tap to hear what they say.';
  return (
    <button
      type="button"
      className={cx('les-spot', found && 'is-found', current && 'is-current', spot.x < 35 && 'les-spot--left', spot.x > 65 && 'les-spot--right')}
      // The circle from the data: centre x, y and radius r, in percent of the scene.
      style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.r * 2}%` }}
      aria-label={`${number}. ${spot.label}, ${spot.role}. ${state}`}
      aria-pressed={current}
      onClick={onTap}
    >
      <span className="les-spot__frame" />
      <span className="les-spot__label">
        <span className="les-spot__mark">{found ? <IconTick size={20} /> : number}</span>
        {spot.label}
      </span>
    </button>
  );
}

export default function TryItHotspots({ lesson, content }: { lesson: Lesson; content: HotspotContent }) {
  const spots = content.spots;
  const [state, setState] = useState<HotspotState>(() => freshHotspots(spots.length));
  const count = foundCount(state);
  const done = isComplete(state, content.goal);
  const saved = useRef(false);

  // Reaching the goal finishes the lesson (once).
  useEffect(() => {
    if (done && !saved.current) {
      saved.current = true;
      finishLesson(lesson.id);
    }
  }, [done, lesson.id]);

  // Leaving the screen stops a voice that is still speaking.
  useEffect(() => stopListening, []);

  function show(index: number): void {
    const spot = spots[index];
    if (!spot) return;
    setState((previous) => tapSpot(previous, index));
    // One voice at a time, fetched only now, through the shared narration player.
    if (spot.audioUrl) startListening(spot.audioUrl);
    else stopListening();
  }

  function replay(): void {
    stopListening();
    saved.current = false;
    setState(freshHotspots(spots.length));
  }

  const current = state.current === -1 ? undefined : spots[state.current];
  const next = lesson.next;
  const nextLink = next ? (
    <ButtonLink to={paths.lesson(next.id)} fullWidth iconAfter={<IconArrowRight size={28} />}>
      Next: {nextLabel(next)}
    </ButtonLink>
  ) : (
    <ButtonLink to={seriesPath(lesson)} fullWidth icon={<IconBack size={28} />}>
      Back to the lessons
    </ButtonLink>
  );

  return (
    <div className="les-try">
      <div className="les-try__task">
        <p className="les-try__instruction">
          <IconTryIt size={30} />
          {content.instruction}
        </p>
        <div className="les-try__count" role="status">
          <span>
            {count} of {spots.length} found
          </span>
          <span className="les-try__dots" aria-hidden="true">
            {state.found.map((found, index) => (
              <span key={index} className={cx('les-try__dot', found && 'is-found')}>
                {found ? <IconTick size={16} /> : null}
              </span>
            ))}
          </span>
        </div>
      </div>

      <div className="les-try__layout">
        <section className={cx('sb-card sb-card--lg sb-card--tappable les-try__scene', content.gentleMovement && 'les-try__scene--gentle')} aria-label={`${content.scene.alt} ${content.instruction}`}>
          <div className="les-try__stage">
            <Illustration className="les-try__picture" src={content.scene.url} alt="" eager />
            {spots.map((spot, index) => (
              <Spot key={spot.id} spot={spot} number={index + 1} found={!!state.found[index]} current={state.current === index} onTap={() => show(index)} />
            ))}
          </div>
        </section>

        <div className="les-try__side">
          <div aria-live="polite" className="les-try__speech">
            {current ? (
              <div className="les-speech">
                {current.portrait ? <Illustration className="les-speech__portrait" src={current.portrait.url} alt={current.portrait.alt} width={76} height={76} eager /> : null}
                <div className="les-speech__text">
                  <p className="les-speech__name">
                    {current.label}
                    <span className="les-speech__found">
                      <IconTick size={18} />
                      Found
                    </span>
                  </p>
                  <p className="les-speech__role">{current.role}</p>
                  <p className="les-speech__says">“{current.says}”</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="les-try__buttons">
            <Button className="les-try__next" iconAfter={<IconArrowRight size={28} />} onClick={() => show(nextSpot(state))}>
              Next person
            </Button>
            <Button variant="secondary" icon={<IconTryAgain size={28} />} onClick={replay}>
              Replay
            </Button>
          </div>
          {content.gentleMovement ? (
            <p className="les-note les-try__motion">
              <IconInfo size={26} />
              <span>Moves gently. Turns off if your phone is set to reduce motion.</span>
            </p>
          ) : null}
        </div>
      </div>

      {done ? (
        <div className="les-try__done" role="status">
          <p className="les-try__well">
            <span className="les-try__tick" aria-hidden="true">
              <IconTick size={28} />
            </span>
            {content.finishMessage}
          </p>
          <SaveNote lessonId={lesson.id} />
          {nextLink}
        </div>
      ) : (
        <section className="les-try__goal" aria-labelledby="les-try-goal">
          <h2 id="les-try-goal" className="les-try__goal-title">
            {content.goal === 'any' ? 'When you find one' : `When you find all ${spots.length}`}
          </h2>
          <p className="les-try__goal-step les-try__goal-step--well">
            <span className="les-try__goal-mark" aria-hidden="true">
              <IconTick size={24} />
            </span>
            {content.finishMessage}
          </p>
          {next ? (
            <p className="les-try__goal-step">
              <span className="les-try__goal-mark les-try__goal-mark--next" aria-hidden="true">
                <LessonTypeIcon type={next.type} size={24} />
              </span>
              Next: {nextLabel(next)}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
