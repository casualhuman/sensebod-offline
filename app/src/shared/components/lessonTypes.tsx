/*
 * Everything the UI says about a lesson type comes from here, driven by the
 * lesson's data tag: the icon, the tag word, the main button and the facts
 * row. Nobody types these words by hand on a screen.
 */
import type { ReactNode } from 'react';
import type { LessonTag, LessonType } from '../api/types';
import { IconCheckQuiz, IconHeadphones, IconRead, IconTryIt, IconWatch, type IconProps } from '../icons';

export interface LessonTypeInfo {
  /** The tag word: Watch, Listen, Read, Try it, Check. */
  label: string;
  /** Main button text for a lesson of this type. */
  action: string;
  Icon: (props: IconProps) => ReactNode;
}

export const LESSON_TYPES: Record<LessonType, LessonTypeInfo> = {
  watch: { label: 'Watch', action: 'Watch video', Icon: IconWatch },
  listen: { label: 'Listen', action: 'Play audio', Icon: IconHeadphones },
  read: { label: 'Read', action: 'Read', Icon: IconRead },
  try: { label: 'Try it', action: 'Start', Icon: IconTryIt },
  check: { label: 'Check', action: 'Start the quiz', Icon: IconCheckQuiz },
};

/** The four types in the learner filter, in board order. Check is never in the filter. */
export const FILTER_TYPES = ['watch', 'listen', 'read', 'try'] as const;

/** Main button words. An interactive video reads "Watch and answer". */
export function lessonActionLabel(tag: Pick<LessonTag, 'type' | 'interactive'>): string {
  if (tag.type === 'watch' && tag.interactive) return 'Watch and answer';
  return LESSON_TYPES[tag.type].action;
}

/** "Lesson 4", or "Quiz" for the Check at the end of a series. */
export function lessonPositionLabel(lesson: { type: LessonType; position: number | null }): string {
  if (lesson.type === 'check' || lesson.position === null) return 'Quiz';
  return `Lesson ${lesson.position}`;
}

/** 102 → "1:42". null → the board placeholder "[length]". Never invents a time. */
export function formatLength(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds) || seconds < 0) return '[length]';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

/** Read lessons: "3 pages", "1 page", or the placeholder "[pages] pages". */
export function formatPages(pages: number | null): string {
  if (pages === null) return '[pages] pages';
  return pages === 1 ? '1 page' : `${pages} pages`;
}

/**
 * Whether to show the "You take part" pill: always on Try it, on other
 * lessons when the tag says so, never on the Check quiz (its tag already
 * says what the learner does).
 */
export function takesPart(tag: Pick<LessonTag, 'type' | 'interactive'>): boolean {
  if (tag.type === 'check') return false;
  return tag.type === 'try' || tag.interactive;
}
