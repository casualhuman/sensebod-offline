/*
 * The pieces every lesson screen is assembled from, as drawn on CPB-Video,
 * CPB-Audio, CPB-TryIt, CPB-WatchAnswer, CPB-Read and AGB-Agri-Video:
 * the header (type pill, title, facts, Listen), "Lesson 2 of 4" progress,
 * "What you will learn", "Up next" and the Child protection help card.
 */
import type { ReactNode } from 'react';
import type { Lesson, LessonSummary } from '@shared/api';
import {
  Badge,
  ButtonLink,
  Card,
  cx,
  FactsRow,
  LESSON_TYPES,
  LessonHeaderPill,
  lessonActionLabel,
  lessonPositionLabel,
  LessonTypeIcon,
  takesPart,
  YouTakePart,
} from '@shared/components';
import { IconArrowRight, IconBack, IconClock, IconHeart, IconHelp } from '@shared/icons';
import { paths } from '@shared/router';
import { ListenBar } from '@shared/shell';
import type { SeriesProgress as SeriesProgressData } from '../progress/progress';
import { IconLightbulb } from './icons';
import { describeSteps, seriesSteps, summariseSeries, type StepLook } from './steps';

export const TITLE_ID = 'les-title';

/** Where Back goes from a lesson: its series' lesson list. */
export function seriesPath(lesson: Pick<Lesson, 'portal' | 'group' | 'series'>): string {
  return paths.series(lesson.portal.id, lesson.group.id, lesson.series.id);
}

export function isChildProtection(lesson: Pick<Lesson, 'portal'>): boolean {
  return lesson.portal.id === 'child-protection';
}

/**
 * The words above the title. A lesson where the learner takes part shows a
 * round badge, the words and the "You take part" pill (CPB-TryIt,
 * CPB-WatchAnswer); the others show the filled pill (CPB-Video).
 */
export function LessonKicker({ lesson }: { lesson: LessonSummary }) {
  if (!takesPart(lesson)) return <LessonHeaderPill type={lesson.type} detail={lessonPositionLabel(lesson)} />;
  return (
    <div className="les-kicker">
      <Badge size="sm">
        <LessonTypeIcon type={lesson.type} size={28} />
      </Badge>
      <span className="les-kicker__words">
        {lessonPositionLabel(lesson)} · <strong>{LESSON_TYPES[lesson.type].label}</strong>
      </span>
      <YouTakePart />
    </div>
  );
}

export interface LessonHeaderProps {
  lesson: Lesson;
  /** One line under the title (CPB-WatchAnswer: "The video stops to ask you a question…"). */
  hint?: string;
  /** The title sits elsewhere on this screen (AGB-Agri-Video puts it under the player). */
  withoutTitle?: boolean;
  children?: ReactNode;
}

/** Kicker, title, facts row and (on phones) Listen with the language switch. */
export function LessonHeader({ lesson, hint, withoutTitle, children }: LessonHeaderProps) {
  return (
    <header className="les-header">
      <LessonKicker lesson={lesson} />
      {withoutTitle ? null : (
        <>
          <h1 id={TITLE_ID} className={cx('sb-h1', 'les-header__title')}>
            {lesson.title}
          </h1>
          {hint ? <p className="les-header__hint">{hint}</p> : null}
          {takesPart(lesson) ? null : <FactsRow tag={lesson} className="les-header__facts" />}
          <ListenBar src={lesson.listenUrl} className="les-header__listen" />
        </>
      )}
      {children}
    </header>
  );
}

const STEP_CLASS: Record<StepLook, string | false> = {
  finished: 'sb-steps__step--finished',
  // The open lesson uses the library's "started" look: thick edge, part filled.
  now: 'sb-steps__step--started',
  begun: 'les-step--begun',
  todo: false,
};

/** "Lesson 1 of 4 · Staying safe", one segment per lesson, then the same in words. */
export function SeriesProgress({ lesson, progress }: { lesson: Lesson; progress: SeriesProgressData }) {
  if (lesson.position === null) return null;
  const count = Math.max(lesson.series.lessonCount, lesson.position);
  const window = seriesSteps(lesson.position, count, progress.states);
  const place = `Lesson ${lesson.position} of ${count}`;
  // Topic portals (Agriculture, Climate) name the topic first, as AGB-Agri-Video does.
  const byTopic = lesson.portal.groupKind === 'topic';
  let words: string;
  if (!progress.known) words = 'You are learning as a guest · progress is not saved';
  else {
    words = summariseSeries(lesson.position, count, progress.states, lesson.type);
    if (progress.own && progress.own.state === 'finished') words += ' · You finished this one before';
  }
  return (
    <section className="les-progress" aria-label="Lesson progress">
      <p className="les-progress__place">
        {byTopic ? null : <IconClock size={28} className="les-progress__icon" />}
        {byTopic ? (
          <span>
            {lesson.group.title} · {place}
          </span>
        ) : (
          <span>
            {place} <span className="les-progress__series">· {lesson.series.title}</span>
          </span>
        )}
      </p>
      <div className="sb-steps" role="img" aria-label={describeSteps(window, lesson.type)}>
        {window.steps.map((look, index) => (
          <span key={window.first + index} className={cx('sb-steps__step', STEP_CLASS[look])} />
        ))}
      </div>
      <p className="les-progress__words">{words}</p>
    </section>
  );
}

/** "What you will learn": the lines the admin wrote for this lesson. Nothing when there are none. */
export function LearningPoints({ points }: { points: readonly string[] }) {
  if (points.length === 0) return null;
  return (
    <div className="les-learn">
      <IconLightbulb size={34} className="les-learn__icon" />
      <div>
        <p className="les-learn__title">What you will learn</p>
        <p className="les-learn__text">{points.join(' ')}</p>
      </div>
    </div>
  );
}

/** "Next: Lesson 2 · Listen" in words, the same on every screen that names the next lesson. */
export function nextLabel(next: LessonSummary): string {
  if (next.type === 'check') return 'Check · Quiz';
  const type = next.type === 'watch' && next.interactive ? 'Watch and answer' : LESSON_TYPES[next.type].label;
  return `${lessonPositionLabel(next)} · ${type}`;
}

/** The "Up next" card. When this is the last lesson it offers the way back to the list instead. */
export function UpNext({ lesson }: { lesson: Lesson }) {
  const next = lesson.next;
  if (!next) {
    return (
      <section className="les-next">
        <h2 className="sb-h3 les-next__heading">Up next</h2>
        <p className="les-next__last">This is the last lesson here.</p>
        <ButtonLink to={seriesPath(lesson)} variant="secondary" fullWidth icon={<IconBack size={28} />}>
          Back to the lessons
        </ButtonLink>
      </section>
    );
  }
  return (
    <section className="les-next">
      <h2 className="sb-h3 les-next__heading">Up next</h2>
      <Card to={paths.lesson(next.id)} current className="les-next__card">
        <Badge>
          <LessonTypeIcon type={next.type} size={36} />
        </Badge>
        <span className="les-next__text">
          <span className="les-next__kicker">
            Next: {next.type === 'check' ? <strong>Check</strong> : lessonPositionLabel(next)} · {next.type === 'check' ? 'Quiz' : <strong>{LESSON_TYPES[next.type].label}</strong>}
            {takesPart(next) ? <YouTakePart className="les-next__pill" /> : null}
          </span>
          <span className="les-next__title">{next.title}</span>
          <span className="les-next__summary">{next.summary || lessonActionLabel(next)}</span>
        </span>
        <IconArrowRight size={30} className="les-next__arrow" />
      </Card>
    </section>
  );
}

/**
 * Child protection only: the way to urgent help on every lesson (CPB-Video
 * and the others). The words change with who is reading (CPB-Read is the
 * parents' lesson).
 */
export function HelpCard({ lesson }: { lesson: Lesson }) {
  if (!isChildProtection(lesson)) return null;
  const forChild = lesson.group.id === 'cp-child';
  return (
    <div className="les-help">
      <p className="les-help__words">
        <IconHeart size={32} className="les-help__icon" />
        {forChild ? 'Something feels wrong? Tell someone you trust.' : 'Worried about a child? See who can help today.'}
      </p>
      <ButtonLink to={paths.help()} variant="danger" fullWidth icon={<IconHelp size={30} />}>
        Get help now
      </ButtonLink>
    </div>
  );
}
