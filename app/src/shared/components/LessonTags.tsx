import type { LessonTag, LessonType, ProgressState } from '../api/types';
import { IconCaptions, IconClock, IconFinished, IconInfo, IconNotStarted, IconRead, IconSound, IconTryIt } from '../icons';
import { cx } from './cx';
import { formatLength, formatPages, LESSON_TYPES } from './lessonTypes';

export type ChipState = ProgressState | 'not-in-bag';

const STATE_WORDS: Record<ChipState, string> = {
  'not-started': 'Not started',
  started: 'Started',
  finished: 'Finished',
  'not-in-bag': 'Not in bag',
};

/** State is always an icon and a word, never colour alone. */
export function StateChip({ state, className }: { state: ChipState; className?: string }) {
  const Glyph = state === 'finished' ? IconFinished : state === 'started' ? IconClock : state === 'not-in-bag' ? IconInfo : IconNotStarted;
  return (
    <span className={cx('sb-state-chip', `sb-state-chip--${state}`, className)}>
      <Glyph size={22} />
      {STATE_WORDS[state]}
    </span>
  );
}

/** The modifier pill for lessons where the learner taps, answers or chooses. It never replaces the tag. */
export function YouTakePart({ className }: { className?: string }) {
  return (
    <span className={cx('sb-take-part', className)}>
      <IconTryIt size={22} />
      You take part
    </span>
  );
}

/** The bold labelled type icon on its own (filter buttons, admin tables). */
export function LessonTypeIcon({ type, size = 28 }: { type: LessonType; size?: number }) {
  const { Icon } = LESSON_TYPES[type];
  return <Icon size={size} />;
}

/** Round type badge that sits on the picture edge of a lesson card. */
export function LessonTypeBadge({ type, size = 'md', overlap = false, className }: { type: LessonType; size?: 'sm' | 'md' | 'lg'; overlap?: boolean; className?: string }) {
  const px = size === 'lg' ? 40 : size === 'sm' ? 24 : 36;
  const sizeClass = size === 'lg' ? 'sb-badge--lg' : size === 'sm' ? 'sb-badge--sm' : '';
  return (
    <span className={cx('sb-badge', sizeClass, overlap && 'sb-badge--overlap', className)} aria-hidden="true">
      <LessonTypeIcon type={type} size={px} />
    </span>
  );
}

/** "Watch · Lesson 4": the tag word first, in bold, then where it sits. */
export function TagLine({ type, detail, className }: { type: LessonType; detail?: string; className?: string }) {
  return (
    <span className={cx('sb-tag-line', className)}>
      <strong>{LESSON_TYPES[type].label}</strong>
      {detail ? ` · ${detail}` : null}
    </span>
  );
}

/** Lesson screen header: "Lesson 1 · Watch" in a pill, same words as the card. */
export function LessonHeaderPill({ type, detail, className }: { type: LessonType; detail: string; className?: string }) {
  return (
    <span className={cx('sb-lesson-pill', className)}>
      <LessonTypeIcon type={type} size={26} />
      <span>
        {detail} · <strong>{LESSON_TYPES[type].label}</strong>
      </span>
    </span>
  );
}

/**
 * Facts row, drawn from the data tag:
 * [length] · Needs sound · Captions (Watch), Read along (Listen), [pages] pages (Read).
 */
export function FactsRow({ tag, inline = false, className }: { tag: LessonTag; /** Inside a link or other phrasing content (a card): plain spans instead of a list. */ inline?: boolean; className?: string }) {
  const showLength = tag.type !== 'read' || tag.length !== null;
  const Row = inline ? 'span' : 'ul';
  const Item = inline ? 'span' : 'li';
  return (
    <Row className={cx('sb-facts', className)}>
      {tag.type === 'read' ? <Item className="sb-facts__item">{formatPages(tag.pages)}</Item> : null}
      {showLength ? (
        <Item className="sb-facts__item">
          <IconClock size={22} />
          <span className="sb-visually-hidden">Length: </span>
          {tag.type === 'read' ? `${Math.max(1, Math.round((tag.length ?? 0) / 60))} min read` : formatLength(tag.length)}
        </Item>
      ) : null}
      {tag.needsSound ? (
        <Item className="sb-facts__item">
          <IconSound size={22} />
          Needs sound
        </Item>
      ) : null}
      {tag.captions ? (
        <Item className="sb-facts__item">
          <IconCaptions size={22} />
          Captions
        </Item>
      ) : null}
      {tag.readAlong ? (
        <Item className="sb-facts__item">
          <IconRead size={22} />
          Read along
        </Item>
      ) : null}
    </Row>
  );
}
