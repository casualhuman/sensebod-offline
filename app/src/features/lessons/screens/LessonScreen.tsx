/*
 * /lesson/:lessonId · one screen for every lesson type. Loads the lesson,
 * draws the frame the boards share (header, progress, "What you will learn",
 * "Up next", the Child protection help card) and puts the right player in it.
 */
import { useEffect, type ReactNode } from 'react';
import { learnerApi, useApi, type Lesson } from '@shared/api';
import { ButtonLink, EmptyState, ErrorState, LoadingState } from '@shared/components';
import { IconHome } from '@shared/icons';
import { paths, useParams } from '@shared/router';
import { useSession } from '@shared/session';
import { PageShell } from '@shared/shell';
import { HelpCard, isChildProtection, LearningPoints, LessonHeader, SeriesProgress, seriesPath, TITLE_ID, UpNext } from '../parts/LessonParts';
import CheckQuiz from '../players/CheckQuiz';
import ListenPlayer from '../players/ListenPlayer';
import PictureLesson, { pictureFrames } from '../players/PictureLesson';
import ReadPlayer from '../players/ReadPlayer';
import TryItHotspots from '../players/TryItHotspots';
import TryItPackage from '../players/TryItPackage';
import WatchPlayer from '../players/WatchPlayer';
import { markStarted, useSeriesProgress } from '../progress/progress';
import '../lessons.css';

function LessonBody({ lesson }: { lesson: Lesson }) {
  const { learner } = useSession();
  const learnerId = learner ? learner.id : null;
  const progress = useSeriesProgress(lesson);
  const content = lesson.content;

  // Opening a lesson marks it started for the learner who is saving progress.
  useEffect(() => {
    if (learnerId) markStarted(lesson.id);
  }, [lesson.id, learnerId]);

  if (content.type === 'check') {
    return (
      <div className="les-page">
        <CheckQuiz lesson={lesson} content={content} />
        <HelpCard lesson={lesson} />
      </div>
    );
  }

  const frames = content.type === 'read' ? pictureFrames(content) : null;
  if (content.type === 'read' && frames) {
    return (
      <div className="les-page">
        <PictureLesson lesson={lesson} frames={frames} cover={content.cover} />
        <div className="les-below">
          <div className="les-below__col">
            <UpNext lesson={lesson} />
          </div>
          <div className="les-below__col">
            <HelpCard lesson={lesson} />
          </div>
        </div>
      </div>
    );
  }

  let player: ReactNode;
  let hint: string | undefined;
  let points: readonly string[] = [];
  if (content.type === 'watch') {
    player = <WatchPlayer lesson={lesson} content={content} progress={progress} />;
    points = content.learningPoints;
    if (content.questions.length > 0) hint = 'The video stops to ask you a question. Tap your answer.';
  } else if (content.type === 'listen') {
    player = <ListenPlayer lesson={lesson} content={content} progress={progress} />;
  } else if (content.type === 'read') {
    player = <ReadPlayer lesson={lesson} content={content} />;
  } else if (content.mode === 'hotspots') {
    player =
      content.spots.length > 0 ? <TryItHotspots lesson={lesson} content={content} /> : <EmptyState title="This activity is not in this bag yet">Ask your facilitator.</EmptyState>;
  } else {
    player = <TryItPackage lesson={lesson} packageUrl={content.packageUrl} />;
  }

  // AGB-Agri-Video: progress above the player, the title under it.
  const titleBelow = lesson.portal.theme === 'agriculture';
  const progressBar = <SeriesProgress lesson={lesson} progress={progress} />;

  return (
    <div className="les-page">
      <LessonHeader lesson={lesson} hint={hint} withoutTitle={titleBelow}>
        {titleBelow ? progressBar : null}
      </LessonHeader>
      {player}
      {titleBelow ? (
        <div className="les-under">
          <h1 id={TITLE_ID} className="sb-h1">
            {lesson.title}
          </h1>
          {lesson.summary ? <p className="les-under__summary">{lesson.summary}</p> : null}
        </div>
      ) : null}
      <div className="les-below">
        <div className="les-below__col">
          {titleBelow ? null : progressBar}
          <LearningPoints points={points} />
        </div>
        <div className="les-below__col">
          <UpNext lesson={lesson} />
          <HelpCard lesson={lesson} />
        </div>
      </div>
    </div>
  );
}

export default function LessonScreen() {
  const { lessonId } = useParams<'lessonId'>();
  const { data: lesson, error, loading, reload } = useApi((signal) => learnerApi.getLesson(lessonId, { signal }), [lessonId]);
  return (
    <PageShell
      title={lesson ? lesson.title : 'Lesson'}
      theme={lesson ? lesson.portal.theme : undefined}
      backTo={lesson ? seriesPath(lesson) : paths.home()}
      quickExit={lesson ? isChildProtection(lesson) : false}
      listenSrc={lesson ? lesson.listenUrl : null}
    >
      {loading && !lesson ? <LoadingState label="Opening the lesson…" /> : null}
      {error ? (
        <ErrorState
          title="This lesson did not open"
          error={error}
          onRetry={reload}
          action={
            <ButtonLink to={paths.home()} variant="secondary" fullWidth icon={<IconHome size={28} />}>
              Go to Home
            </ButtonLink>
          }
        />
      ) : null}
      {/* The key gives every lesson a fresh player: no state or media carries over. */}
      {lesson && !error ? <LessonBody key={lesson.id} lesson={lesson} /> : null}
    </PageShell>
  );
}
