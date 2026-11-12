import type { ReactNode } from 'react';
import type { LessonSummary, Picture, ProgressState, ThemeName } from '../api/types';
import { IconArrowRight } from '../icons';
import { Link } from '../router';
import { ButtonLook } from './Button';
import { cx } from './cx';
import { ScenePicture, type PictureShape } from './Illustration';
import { FactsRow, LessonTypeBadge, LessonTypeIcon, StateChip, TagLine, YouTakePart, type ChipState } from './LessonTags';
import { lessonActionLabel, lessonPositionLabel, takesPart } from './lessonTypes';
import { ProgressTrack } from './Progress';

export interface CardProps {
  /** Makes the whole card one link with the tappable edge (2px, at least 3:1 on the page). */
  to?: string;
  /** Tappable edge without being a link (the card contains its own controls). */
  tappable?: boolean;
  /** 3px accent edge: the card to continue with. */
  current?: boolean;
  /** 2px solid accent edge (the Agriculture portal card on Home). */
  frame?: boolean;
  /** Dashed grey: listed but not in this bag. Never a link. */
  unavailable?: boolean;
  /** 24px corners (portal cards, hero sections). */
  large?: boolean;
  /** Switch the colour roles for this card only (the green Agriculture card on a blue page). */
  theme?: ThemeName;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** White card with the 2px edge. The base of every card on the boards. */
export function Card({ to, tappable, current, frame, unavailable, large, theme, className, children, ...aria }: CardProps) {
  const classes = cx(
    'sb-card',
    large && 'sb-card--lg',
    (to || tappable) && !unavailable && 'sb-card--tappable',
    frame && 'sb-card--frame',
    current && 'sb-card--current',
    unavailable && 'sb-card--unavailable',
    className,
  );
  const themeAttr = theme === 'agriculture' ? 'agriculture' : undefined;
  if (to && !unavailable) {
    return (
      <Link {...aria} to={to} className={classes} data-theme={themeAttr}>
        {children}
      </Link>
    );
  }
  return (
    <div {...aria} className={classes} data-theme={themeAttr} aria-disabled={unavailable || undefined}>
      {children}
    </div>
  );
}

export interface BadgeProps {
  /** A 3px-stroke icon, drawn 32-42px. */
  children: ReactNode;
  /** sm 48 (no ring), md 64, default 68, lg 76, xl 80. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Pull the badge up so it sits half on the picture above. */
  overlap?: boolean;
  tone?: 'accent' | 'muted' | 'success' | 'danger';
  className?: string;
}

/** Round solid badge with a white ring, so it reads on the picture tint and on the white card. */
export function Badge({ children, size, overlap, tone, className }: BadgeProps) {
  return (
    <span className={cx('sb-badge', size && `sb-badge--${size}`, overlap && 'sb-badge--overlap', tone && tone !== 'accent' && `sb-badge--${tone}`, className)} aria-hidden="true">
      {children}
    </span>
  );
}

export interface PortalCardProps {
  to: string;
  title: string;
  description: string;
  picture: Picture | null;
  /** 40px portal icon, e.g. <IconPortalPrimary size={40} />. */
  icon: ReactNode;
  /** 'agriculture' draws the one green card. */
  theme?: ThemeName;
  eager?: boolean;
}

/** Home gateway card: scene, round badge on the picture edge, Open pill, big title. */
export function PortalCard({ to, title, description, picture, icon, theme, eager }: PortalCardProps) {
  return (
    <Card to={to} large theme={theme} frame={theme === 'agriculture'}>
      <ScenePicture picture={picture} shape="portal" eager={eager} />
      <span className="sb-card__body">
        <span className="sb-portal-card__top">
          <Badge size="lg" overlap>
            {icon}
          </Badge>
          <span className="sb-open-pill">
            Open
            <IconArrowRight size={24} />
          </span>
        </span>
        <span className="sb-portal-card__title">{title}</span>
        <span className="sb-portal-card__text">{description}</span>
      </span>
    </Card>
  );
}

export interface TopicCardProps {
  /** Left out (or state "not-in-bag") the card is not a link. */
  to?: string;
  title: string;
  picture: Picture | null;
  /** 32px topic icon for the badge. */
  icon: ReactNode;
  state: ChipState;
  /** Optional tag line above the title, e.g. <TagLine type="watch" detail="12 videos" />. */
  tag?: ReactNode;
  /** Line under the title: "4 videos", "Not in this bag yet. Ask your facilitator." */
  detail?: string;
  /** With `total`, shows "1 of 5 done" and the bar when started. */
  done?: number;
  total?: number;
  pictureShape?: PictureShape;
}

/** Class, audience or topic card in its 4 states: started, not started, finished, not in bag. */
export function TopicCard({ to, title, picture, icon, state, tag, detail, done, total, pictureShape = 'topic' }: TopicCardProps) {
  const unavailable = state === 'not-in-bag';
  const hasCount = typeof done === 'number' && typeof total === 'number' && total > 0;
  let line = detail;
  if (!line && state === 'finished') line = 'All done. Well done!';
  if (!line && state === 'started' && hasCount) line = `${done} of ${total} done`;
  return (
    <Card to={unavailable ? undefined : to} unavailable={unavailable} className="sb-topic-card">
      <ScenePicture picture={picture} shape={pictureShape} />
      <span className="sb-card__body">
        <span className="sb-topic-card__top">
          <Badge size="md" overlap tone={unavailable ? 'muted' : 'accent'}>
            {icon}
          </Badge>
          <StateChip state={state} />
        </span>
        {tag ? <span className="sb-topic-card__tag">{tag}</span> : null}
        <span className="sb-topic-card__title">{title}</span>
        {line ? <span className={cx('sb-topic-card__detail', (state === 'started' || state === 'finished') && 'sb-topic-card__detail--done')}>{line}</span> : null}
        {state === 'started' && hasCount ? <ProgressTrack done={done as number} total={total as number} label={`${done} of ${total} lessons done`} /> : null}
      </span>
    </Card>
  );
}

export interface LessonCardProps {
  lesson: LessonSummary;
  /** Where the card goes, usually paths.lesson(lesson.id). */
  to: string;
  state: ProgressState;
  /** 3px accent edge: the lesson to continue with. */
  current?: boolean;
  /** Small line above the tag line, e.g. "Continue where you stopped". */
  eyebrow?: string;
  /** Replaces "Lesson 4" in the tag line, e.g. "Lesson 2 of 12". */
  positionLabel?: string;
  eager?: boolean;
}

/**
 * Lesson card. The anatomy is the same on every card, in this order:
 * picture, type badge, tag line, "You take part" pill, state chip, title,
 * facts row, main button. Everything is drawn from the lesson's data tag.
 * The whole card is one link; a finished lesson gets the outlined button.
 */
export function LessonCard({ lesson, to, state, current, eyebrow, positionLabel, eager }: LessonCardProps) {
  return (
    <Card to={to} current={current} className="sb-lesson-card">
      <ScenePicture picture={lesson.picture} eager={eager} />
      <span className="sb-card__body">
        <span className="sb-lesson-card__top">
          <LessonTypeBadge type={lesson.type} overlap />
          <span className="sb-lesson-card__tag">
            {eyebrow ? <span className="sb-lesson-card__eyebrow">{eyebrow}</span> : null}
            <TagLine type={lesson.type} detail={positionLabel ?? lessonPositionLabel(lesson)} />
          </span>
        </span>
        <span className="sb-lesson-card__chips">
          {takesPart(lesson) ? <YouTakePart /> : null}
          <StateChip state={state} />
        </span>
        <span className="sb-lesson-card__title">{lesson.title}</span>
        {lesson.summary ? <span className="sb-lesson-card__summary">{lesson.summary}</span> : null}
        <FactsRow tag={lesson} />
        <ButtonLook
          className="sb-lesson-card__action"
          variant={state === 'finished' ? 'secondary' : 'primary'}
          fullWidth
          icon={<LessonTypeIcon type={lesson.type} size={28} />}
        >
          {lessonActionLabel(lesson)}
        </ButtonLook>
      </span>
    </Card>
  );
}
