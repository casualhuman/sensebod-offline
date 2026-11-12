import type { FilterableLessonType } from '../api/types';
import { IconAll } from '../icons';
import { cx } from './cx';
import { LessonTypeIcon } from './LessonTags';
import { FILTER_TYPES, LESSON_TYPES } from './lessonTypes';

export type LessonFilterValue = 'all' | FilterableLessonType;

export interface LessonFilterProps {
  value: LessonFilterValue;
  onChange: (value: LessonFilterValue) => void;
  /**
   * Types to offer besides All. Default: Watch, Listen, Read, Try it.
   * Pass fewer only when a list can never contain a type.
   */
  types?: readonly FilterableLessonType[];
  /** Accessible name of the group. */
  label?: string;
  className?: string;
}

/**
 * Filter above every lesson list: All · Watch · Listen · Read · Try it.
 * Phone: two rows (3 + 2), nothing hidden, no scrolling. Tablet and laptop:
 * one row. Selected = filled + aria-pressed; the icon and the word stay.
 * Check is never in the filter (one quiz per series, always last).
 */
export function LessonFilter({ value, onChange, types = FILTER_TYPES, label = 'Show lessons by type', className }: LessonFilterProps) {
  const count = types.length + 1;
  return (
    <div role="group" aria-label={label} className={cx('sb-filter', `sb-filter--${count}`, className)}>
      <button type="button" className="sb-filter__option" aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        <IconAll size={28} />
        All
      </button>
      {types.map((type) => (
        <button key={type} type="button" className="sb-filter__option" aria-pressed={value === type} onClick={() => onChange(type)}>
          <LessonTypeIcon type={type} size={28} />
          {LESSON_TYPES[type].label}
        </button>
      ))}
    </div>
  );
}

/** Keeps the lessons that match the filter. The Check quiz always stays (it is the end of the series). */
export function filterLessons<T extends { type: string }>(lessons: readonly T[], value: LessonFilterValue): T[] {
  if (value === 'all') return lessons.slice();
  return lessons.filter((lesson) => lesson.type === value || lesson.type === 'check');
}
