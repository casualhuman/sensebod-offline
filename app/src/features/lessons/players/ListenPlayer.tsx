/*
 * Listen · audio with Read along (CPB-Audio). Native <audio>; nothing is
 * requested until Play is tapped; the file is detached on unmount.
 */
import { useEffect, useState } from 'react';
import type { Lesson, ListenContent, TranscriptLine } from '@shared/api';
import { cx, EmptyState, Illustration } from '@shared/components';
import { IconInfo, IconRead, IconSound, IconTick } from '@shared/icons';
import { Controls, MediaProblemNote, SeekBar, Toggle, Transport } from '../media/MediaControls';
import { useMedia } from '../media/useMedia';
import { FinishedActions, SaveNote } from '../parts/Finished';
import { IconSoundOff } from '../parts/icons';
import { finishLesson, savePosition, type SeriesProgress } from '../progress/progress';

export interface ListenPlayerProps {
  lesson: Lesson;
  content: ListenContent;
  progress: SeriesProgress;
}

/** The line being spoken at `time`: the last timed line that has started. -1 when the words are not timed. */
export function currentLine(transcript: readonly TranscriptLine[], time: number): number {
  let found = -1;
  for (let index = 0; index < transcript.length; index += 1) {
    const line = transcript[index];
    if (line && line.start !== null && line.start <= time) found = index;
  }
  return found;
}

export default function ListenPlayer({ lesson, content, progress }: ListenPlayerProps) {
  const [readAlong, setReadAlong] = useState(true);
  const own = progress.own;
  const media = useMedia<HTMLAudioElement>(content.sources, {
    startAt: own && own.state === 'started' && own.positionSeconds !== null && own.positionSeconds >= 5 ? own.positionSeconds : null,
    onPause: (seconds) => savePosition(lesson.id, seconds),
    onEnded: () => finishLesson(lesson.id),
  });

  // Leaving the lesson part-way: remember the place.
  useEffect(() => {
    const element = media.ref.current;
    return () => {
      if (element && !element.ended && element.currentTime > 0) savePosition(lesson.id, element.currentTime);
    };
  }, [lesson.id, media.ref]);

  if (content.sources.length === 0) {
    return <EmptyState title="This story is not in this bag yet">Ask your facilitator.</EmptyState>;
  }

  const hasWords = content.transcript.length > 0;
  const speaking = media.started && media.status !== 'ended' ? currentLine(content.transcript, media.time) : -1;
  const ended = media.status === 'ended';
  const failed = media.status === 'error';

  return (
    <>
      <section className="sb-card sb-card--lg sb-card--tappable les-player les-player--audio" aria-label="Audio player">
        {/* The element is in the page (not `new Audio()`) so it is released with the screen. */}
        <audio ref={media.ref} preload="none" aria-label={lesson.title} />
        {content.cover ? <Illustration className="les-audio__cover" src={content.cover.url} alt={content.cover.alt} eager /> : null}

        {failed ? (
          <MediaProblemNote problem={media.problem} what="sound" onRetry={media.retry} />
        ) : (
          <>
            <SeekBar label="Story time" time={media.time} duration={media.duration} knownLength={lesson.length} onSeek={media.seek} />
            <Controls toggles={hasWords ? 2 : 1}>
              {hasWords ? (
                <Toggle icon={<IconRead size={36} />} pressed={readAlong} controls="les-read-along" onClick={() => setReadAlong((on) => !on)}>
                  {readAlong ? 'Read along: on' : 'Read along: off'}
                </Toggle>
              ) : null}
              <Transport status={media.status} onToggle={media.toggle} onSkip={media.skip} round />
              <Toggle icon={media.muted ? <IconSoundOff size={36} /> : <IconSound size={36} />} pressed={media.muted} onClick={() => media.setMuted(!media.muted)}>
                {media.muted ? 'Sound off' : 'Sound'}
              </Toggle>
            </Controls>
          </>
        )}

        {hasWords ? (
          <div id="les-read-along" role="region" aria-label="Read along: the words of the story" className="les-words" hidden={!readAlong}>
            <p className="les-words__title">The words of the story</p>
            {content.transcript.map((line, index) => (
              <p key={index} className={cx('les-words__line', index === speaking && 'is-now')} aria-current={index === speaking ? 'true' : undefined}>
                {index === speaking ? <IconSound size={24} className="les-words__icon" /> : null}
                <span>
                  {index === speaking ? <span className="sb-visually-hidden">Now: </span> : null}
                  {line.text}
                </span>
              </p>
            ))}
          </div>
        ) : null}

        {ended ? (
          <div className="les-player__after">
            <p className="les-player__done" role="status">
              <IconTick size={28} />
              Well done! You listened to the end.
            </p>
            <SaveNote lessonId={lesson.id} />
            <FinishedActions lesson={lesson} onAgain={media.replay} />
          </div>
        ) : null}
      </section>

      {ended || failed ? null : (
        <p className="les-note">
          <IconInfo size={24} />
          The story never starts by itself. Tap Play to start.
        </p>
      )}
    </>
  );
}
