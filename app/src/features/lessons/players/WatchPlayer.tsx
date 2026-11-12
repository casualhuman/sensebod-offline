/*
 * Watch · the video player, and "Watch and answer" (a video that stops for
 * questions). Boards: V3-Components "Video player · 3 states" (A ready,
 * B playing, C finished), CPB-Video, AGB-Agri-Video, CPB-WatchAnswer(-Tab).
 *
 * Native <video> only. Nothing is requested before the learner taps Play;
 * captions are fetched after that; the file is detached on unmount.
 */
import { useEffect, useRef, useState } from 'react';
import type { Lesson, WatchContent } from '@shared/api';
import { Button, cx, EmptyState, formatLength, Illustration } from '@shared/components';
import { IconCaptions, IconFullScreen, IconInfo, IconPause, IconPlay, IconQuestion, IconSound, IconSpinner, IconTick } from '@shared/icons';
import { useSession } from '@shared/session';
import { Controls, MediaProblemNote, SeekBar, Toggle, Transport } from '../media/MediaControls';
import { useFullscreen } from '../media/fullscreen';
import { useMedia } from '../media/useMedia';
import { FinishedActions, SaveNote } from '../parts/Finished';
import { IconExitFullScreen, IconSoundOff } from '../parts/icons';
import { finishLesson, savePosition, type SeriesProgress } from '../progress/progress';
import { Answers } from '../quiz/Answers';
import { FRESH, isSettled, pickAnswer, questionDue, scoreQuiz, type QuestionState } from '../quiz/quizLogic';

export interface WatchPlayerProps {
  lesson: Lesson;
  content: WatchContent;
  progress: SeriesProgress;
}

/** Saved place to carry on from: only when it is worth it, never for a finished lesson. */
function resumeFrom(progress: SeriesProgress): number | null {
  const own = progress.own;
  if (!own || own.state !== 'started' || own.positionSeconds === null || own.positionSeconds < 5) return null;
  return own.positionSeconds;
}

/** Caption text without WebVTT markup such as <v Speaker>. Shown as text, never as HTML. */
function cueText(track: TextTrack): string {
  const cues = track.activeCues;
  if (!cues) return '';
  const lines: string[] = [];
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index] as VTTCue | undefined;
    if (cue && typeof cue.text === 'string') lines.push(cue.text.replace(/<[^>]*>/g, ''));
  }
  return lines.join(' ');
}

export default function WatchPlayer({ lesson, content, progress }: WatchPlayerProps) {
  const { language } = useSession();
  const questions = content.questions;
  const interactive = questions.length > 0;

  const [answers, setAnswers] = useState<QuestionState[]>(() => questions.map(() => FRESH));
  /** Questions the learner has gone past (answered, or skipped where the author allows it). */
  const [passed, setPassed] = useState<boolean[]>(() => questions.map(() => false));
  /** The question on screen now, or -1. */
  const [open, setOpen] = useState(-1);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [caption, setCaption] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ open, passed, answers });
  stateRef.current = { open, passed, answers };

  const media = useMedia<HTMLVideoElement>(content.sources, {
    startAt: resumeFrom(progress),
    onTime: (seconds) => {
      const now = stateRef.current;
      if (!interactive || now.open !== -1) return;
      const due = questionDue(questions, now.passed, seconds);
      const question = questions[due];
      if (!question) return;
      const element = media.ref.current;
      if (element) {
        element.pause();
        // Arrived by seeking past it: go back to where the question belongs.
        if (seconds > question.atSeconds + 1) element.currentTime = question.atSeconds;
      }
      setOpen(due);
    },
    onPause: (seconds) => savePosition(lesson.id, seconds),
    onEnded: () => finishLesson(lesson.id, interactive ? scoreQuiz(questions, stateRef.current.answers) : null),
  });
  const fullscreen = useFullscreen(stageRef, media.ref);

  const track = content.captions.filter((item) => item.language === language)[0] ?? content.captions[0];
  const hasCaptions = !!track;

  // Captions are drawn by us (the dark line at the bottom of the picture on
  // the board), so the track is kept "hidden": loaded and timed, not painted
  // by the browser. The file is only requested once the video has started.
  useEffect(() => {
    const element = trackRef.current;
    const textTrack = element ? element.track : null;
    if (!textTrack) return undefined;
    textTrack.mode = captionsOn ? 'hidden' : 'disabled';
    if (!captionsOn) {
      setCaption('');
      return undefined;
    }
    const onCue = () => setCaption(cueText(textTrack));
    textTrack.addEventListener('cuechange', onCue);
    return () => textTrack.removeEventListener('cuechange', onCue);
  }, [captionsOn, media.started, track]);

  // A question opened: move to it, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (open !== -1 && cardRef.current) cardRef.current.focus();
  }, [open]);

  // Leaving the lesson part-way: remember the place.
  useEffect(() => {
    const element = media.ref.current;
    return () => {
      if (element && !element.ended && element.currentTime > 0) savePosition(lesson.id, element.currentTime);
    };
  }, [lesson.id, media.ref]);

  if (content.sources.length === 0) {
    return <EmptyState title="This video is not in this bag yet">Ask your facilitator.</EmptyState>;
  }

  const openQuestion = open === -1 ? undefined : questions[open];
  const openState = (open === -1 ? undefined : answers[open]) ?? FRESH;
  const mayContinue = !!openQuestion && (isSettled(openState) || !openQuestion.pauseUntilAnswered);
  const waiting = !!openQuestion && !mayContinue;

  function continueVideo(): void {
    if (open === -1) return;
    setPassed((list) => list.map((value, index) => (index === open ? true : value)));
    stateRef.current = { ...stateRef.current, open: -1, passed: passed.map((value, index) => (index === open ? true : value)) };
    setOpen(-1);
    media.play();
  }

  function seekTo(seconds: number): void {
    if (openQuestion && waiting) {
      // Forward is closed until the answer; back is open, to watch the part again.
      if (seconds < openQuestion.atSeconds - 0.5) {
        stateRef.current = { ...stateRef.current, open: -1 };
        setOpen(-1);
        media.seek(seconds);
      }
      return;
    }
    media.seek(seconds);
  }

  function skip(delta: number): void {
    const element = media.ref.current;
    if (element) seekTo(element.currentTime + delta);
  }

  function watchAgain(): void {
    setAnswers(questions.map(() => FRESH));
    setPassed(questions.map(() => false));
    stateRef.current = { open: -1, passed: questions.map(() => false), answers: questions.map(() => FRESH) };
    setOpen(-1);
    media.replay();
  }

  const ended = media.status === 'ended';
  const failed = media.status === 'error';
  const playing = media.status === 'playing';
  const loading = media.status === 'loading';
  const showControls = media.started && !ended && !failed;
  const resume = resumeFrom(progress);
  const toggles = (hasCaptions ? 1 : 0) + 1 + (fullscreen.available && !interactive ? 1 : 0);
  const askedCount = passed.filter(Boolean).length;

  return (
    <section className={cx('sb-card sb-card--lg sb-card--tappable les-player', interactive && 'les-player--questions')} aria-label={interactive ? 'Video player with questions' : 'Video player'}>
      <div ref={stageRef} className={cx('les-stage', fullscreen.active && 'is-full', media.started && 'is-started', openQuestion && 'les-stage--question')}>
        <video
          ref={media.ref}
          className="les-stage__video"
          preload="none"
          playsInline
          aria-label={lesson.title}
          tabIndex={-1}
          onClick={showControls && !openQuestion ? media.toggle : undefined}
        >
          {media.started && track ? <track ref={trackRef} kind="captions" src={track.url} srcLang={track.language} label={track.label} /> : null}
        </video>

        {!media.started || ended || failed ? (
          content.poster ? (
            <Illustration className="les-stage__poster" src={content.poster.url} alt={content.poster.alt} eager />
          ) : (
            <span className="les-stage__poster les-stage__poster--blank" />
          )
        ) : null}

        {ended ? (
          <div className="les-stage__done" role="status">
            <span className="les-stage__tick" aria-hidden="true">
              <IconTick size={48} />
            </span>
            <p className="les-stage__well">Well done!</p>
            <p className="les-stage__finished">You finished this video.</p>
          </div>
        ) : null}

        {openQuestion ? (
          <span className="les-stage__chip les-stage__chip--light">
            <IconQuestion size={22} />
            Paused for a question
          </span>
        ) : null}
        {!openQuestion && media.status === 'paused' ? (
          <span className="les-stage__chip">
            <IconPause size={20} />
            Paused
          </span>
        ) : null}
        {loading ? (
          <span className="les-stage__chip" role="status">
            <IconSpinner size={20} />
            Loading…
          </span>
        ) : null}

        {!ended && !failed && !playing && !loading && !openQuestion ? (
          <button type="button" className="les-stage__play" onClick={media.play}>
            <span className="les-stage__disc" aria-hidden="true">
              <IconPlay size={52} />
            </span>
            <span className="les-stage__play-word">Play video</span>
          </button>
        ) : null}

        {captionsOn && caption && !ended ? <p className="les-stage__caption">{caption}</p> : null}

        {fullscreen.active ? (
          <div className="les-stage__bar">
            <Button size="sm" icon={playing || loading ? <IconPause size={28} /> : <IconPlay size={28} />} onClick={media.toggle}>
              {playing || loading ? 'Pause' : 'Play'}
            </Button>
            <Button size="sm" variant="secondary" icon={<IconExitFullScreen size={28} />} onClick={fullscreen.exit}>
              Leave full screen
            </Button>
          </div>
        ) : null}
      </div>

      {openQuestion ? (
        <div ref={cardRef} tabIndex={-1} className="les-question" role="group" aria-labelledby="les-question-prompt">
          <p className="les-question__count">
            <IconQuestion size={18} />
            Question {open + 1} of {questions.length}
          </p>
          <p id="les-question-prompt" className="les-question__prompt">
            {openQuestion.prompt}
          </p>
          <Answers
            question={openQuestion}
            state={openState}
            marks="rings"
            rightWords="Well done. You can keep watching."
            onPick={(answerId) => setAnswers((list) => list.map((state, index) => (index === open ? pickAnswer(openQuestion, state, answerId) : state)))}
          />
          <Button fullWidth className="les-question__continue" notReady={!mayContinue} icon={<IconPlay size={28} />} onClick={continueVideo}>
            {mayContinue ? 'Continue video' : 'Tap an answer first'}
          </Button>
        </div>
      ) : null}

      <div className="les-player__body">
        {!media.started && !failed ? (
          <p className="les-player__hint">
            <IconInfo size={26} />
            {resume !== null ? `Tap Play to carry on from where you stopped (${formatLength(resume)}).` : 'Tap Play when you are ready.'}
          </p>
        ) : null}

        {failed ? <MediaProblemNote problem={media.problem} what="video" onRetry={media.retry} /> : null}

        {showControls ? (
          <>
            <SeekBar
              label="Video time"
              time={media.time}
              duration={media.duration}
              knownLength={lesson.length}
              onSeek={seekTo}
              markers={interactive ? questions.map((question, index) => ({ at: question.atSeconds, done: !!passed[index] })) : undefined}
              note={openQuestion ? `Stopped at question ${open + 1} of ${questions.length}.` : undefined}
            />
            {interactive ? (
              <p className="les-player__legend">
                <span className="les-player__legend-key">
                  <span className="les-seek__marker les-seek__marker--key" aria-hidden="true" />= a question
                </span>
                <span>
                  {questions.length === 1 ? '1 question in this video' : `${questions.length} questions in this video`}
                  {openQuestion ? ` · You are at question ${open + 1}` : askedCount === questions.length ? ' · All answered' : ''}
                </span>
              </p>
            ) : null}
            <Controls toggles={toggles}>
              {hasCaptions ? (
                <Toggle icon={<IconCaptions size={36} />} pressed={captionsOn} onClick={() => setCaptionsOn((on) => !on)}>
                  {captionsOn ? 'Captions on' : 'Captions off'}
                </Toggle>
              ) : null}
              <Transport status={media.status} onToggle={openQuestion ? continueVideo : media.toggle} onSkip={skip} playLocked={waiting} />
              <Toggle icon={media.muted ? <IconSoundOff size={36} /> : <IconSound size={36} />} pressed={media.muted} onClick={() => media.setMuted(!media.muted)}>
                {media.muted ? 'Sound off' : 'Sound'}
              </Toggle>
              {fullscreen.available && !interactive ? (
                <Toggle icon={<IconFullScreen size={36} />} onClick={fullscreen.enter}>
                  Full screen
                </Toggle>
              ) : null}
            </Controls>
          </>
        ) : null}

        {ended ? (
          <>
            <SaveNote lessonId={lesson.id} />
            <FinishedActions lesson={lesson} onAgain={watchAgain} />
          </>
        ) : null}
      </div>
    </section>
  );
}
