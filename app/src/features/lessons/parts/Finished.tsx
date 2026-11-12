/*
 * What a learner sees after reaching the end: whether the progress was saved
 * (AGB-Agri-Done "Saved for Aminata"), the way to the next lesson, and the
 * two smaller choices (V3-Components video player, state C).
 */
import type { ReactNode } from 'react';
import type { Lesson, LessonType } from '@shared/api';
import { Button, ButtonLink, LoadingState, Message, SuccessState } from '@shared/components';
import { IconBack, IconCheckQuiz, IconGrid, IconNext, IconReplay, IconSave, IconTryAgain } from '@shared/icons';
import { paths } from '@shared/router';
import { retryFinish, useFinishRecord } from '../progress/progress';
import { seriesPath } from './LessonParts';

/**
 * Saved / saving / not saved, for the lesson just finished. A guest is told
 * plainly that nothing was saved and how to turn saving on.
 */
export function SaveNote({ lessonId }: { lessonId: string }) {
  const record = useFinishRecord(lessonId);
  if (!record) return null;
  if (record.status === 'saving') return <LoadingState label="Saving your progress…" className="les-save" />;
  if (record.status === 'saved') {
    return (
      <SuccessState title={`Saved for ${record.learnerName ?? 'you'}`} className="les-save">
        Your progress stays in this bag.
      </SuccessState>
    );
  }
  if (record.status === 'failed') {
    return (
      <Message
        tone="error"
        title="Your progress is not saved yet"
        className="les-save"
        action={
          <Button variant="danger" fullWidth icon={<IconTryAgain size={28} />} onClick={() => retryFinish(lessonId)}>
            Try again
          </Button>
        }
      >
        {record.problem}
      </Message>
    );
  }
  return (
    <Message
      tone="info"
      title="Not saved"
      className="les-save"
      action={
        <ButtonLink to={paths.saveProgress()} variant="secondary" fullWidth icon={<IconSave size={28} />}>
          Save my progress
        </ButtonLink>
      }
    >
      You are learning as a guest.
    </Message>
  );
}

const AGAIN: Record<LessonType, string> = {
  watch: 'Watch again',
  listen: 'Listen again',
  read: 'Read again',
  try: 'Do it again',
  check: 'Do the quiz again',
};

/** Where "Back to …" goes: topic portals return to their topics (AGB-Agri-Done), the others to the lesson list. */
export function backTarget(lesson: Lesson): { to: string; label: string } {
  if (lesson.portal.groupKind === 'topic') return { to: paths.portal(lesson.portal.id), label: 'Back to topics' };
  return { to: seriesPath(lesson), label: 'Back to lessons' };
}

export interface FinishedActionsProps {
  lesson: Lesson;
  /** "Watch again" in place: the player restarts without leaving the screen. */
  onAgain?: () => void;
  /** Otherwise "… again" is a link to the lesson. */
  againTo?: string;
  /** The big button is drawn by the caller (the finished screen has its own). */
  withoutNext?: boolean;
}

/** Main button to the next lesson (or the quiz), then "… again" and "Back to …". */
export function FinishedActions({ lesson, onAgain, againTo, withoutNext }: FinishedActionsProps) {
  const next = lesson.next;
  const back = backTarget(lesson);
  let main: ReactNode = null;
  if (next && !withoutNext) {
    main =
      next.type === 'check' ? (
        <ButtonLink to={paths.lesson(next.id)} size="lg" fullWidth icon={<IconCheckQuiz size={38} />}>
          Take the quiz
        </ButtonLink>
      ) : (
        <ButtonLink to={paths.lesson(next.id)} size="lg" fullWidth icon={<IconNext size={38} />}>
          Next lesson
        </ButtonLink>
      );
  }
  return (
    <div className="les-finished">
      {main}
      <div className="les-finished__pair">
        {onAgain ? (
          <Button stacked variant="secondary" className="les-finished__small" icon={<IconReplay size={36} />} onClick={onAgain}>
            {AGAIN[lesson.type]}
          </Button>
        ) : (
          <ButtonLink to={againTo ?? paths.lesson(lesson.id)} stacked variant="secondary" className="les-finished__small" icon={<IconReplay size={36} />}>
            {AGAIN[lesson.type]}
          </ButtonLink>
        )}
        <ButtonLink
          to={back.to}
          stacked
          variant="secondary"
          className="les-finished__small"
          icon={lesson.portal.groupKind === 'topic' ? <IconGrid size={36} /> : <IconBack size={36} />}
        >
          {back.label}
        </ButtonLink>
      </div>
    </div>
  );
}
