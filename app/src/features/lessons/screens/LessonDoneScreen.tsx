/*
 * /lesson/:lessonId/done · the finished screen (AGB-Agri-Done): well done,
 * the quiz result, whether progress was saved, how far the learner is in
 * the series, and the way to the next lesson.
 *
 * What it shows comes from the finish record of this visit. After a page
 * refresh that record is gone: a saved learner's result is then read back
 * from the bag, and anyone else is sent back to the lesson.
 */
import { learnerApi, useApi, type Lesson } from '@shared/api';
import { Badge, ButtonLink, cx, ErrorState, LoadingState, Message, ScenePicture, SuccessState } from '@shared/components';
import { IconClock, IconHome, IconNext, IconTick, IconTryAgain } from '@shared/icons';
import { paths, useParams } from '@shared/router';
import { useSession } from '@shared/session';
import { ListenBar, PageShell } from '@shared/shell';
import { FinishedActions, SaveNote } from '../parts/Finished';
import { HelpCard, isChildProtection, seriesPath, TITLE_ID } from '../parts/LessonParts';
import { MAX_STEPS } from '../parts/steps';
import { useFinishRecord, useSeriesProgress, type QuizResult, type SeriesProgress } from '../progress/progress';
import '../lessons.css';

function QuizScore({ result }: { result: QuizResult }) {
  return (
    <section className="sb-card les-score" aria-labelledby="les-score">
      <p id="les-score" className="les-score__title">
        Quiz: {result.correct} of {result.total} correct
      </p>
      {result.answers.length > 0 ? (
        <ul className="les-score__list">
          {result.answers.map((right, index) => (
            <li key={index} className={cx('les-score__item', !right && 'les-score__item--again')}>
              <span className="les-score__mark" aria-hidden="true">
                {right ? <IconTick size={28} /> : <IconTryAgain size={26} />}
              </span>
              <span>
                Question {index + 1}
                <span className="sb-visually-hidden">{right ? ': correct' : ': not yet'}</span>
              </span>
              {right ? null : (
                <span className="les-score__word" aria-hidden="true">
                  Not yet
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** "Chickens and quail: 2 of 12 done" with one segment per lesson (five at most). */
function SeriesDone({ lesson, progress }: { lesson: Lesson; progress: SeriesProgress }) {
  if (!progress.known || lesson.position === null) return null;
  const count = Math.max(lesson.series.lessonCount, lesson.position);
  let done = 0;
  for (let number = 1; number <= count; number += 1) {
    // This lesson counts even if the answer from the bag was read just before the save landed.
    if (number === lesson.position || progress.states[number - 1] === 'finished') done += 1;
  }
  const segments = Math.min(count, MAX_STEPS);
  const filled = count <= MAX_STEPS ? done : Math.round((done / count) * segments);
  const words = `${lesson.portal.groupKind === 'topic' ? lesson.group.title : lesson.series.title}: ${done} of ${count} done`;
  const marks: boolean[] = [];
  for (let index = 0; index < segments; index += 1) marks.push(index < filled);
  return (
    <div className="les-progress">
      <p className="les-progress__place">
        <IconClock size={28} className="les-progress__icon" />
        {words}
      </p>
      <div className="sb-steps" role="img" aria-label={`${done} of ${count} lessons done`}>
        {marks.map((on, index) => (
          <span key={index} className={cx('sb-steps__step', on && 'sb-steps__step--finished')} />
        ))}
      </div>
    </div>
  );
}

function DoneBody({ lesson }: { lesson: Lesson }) {
  const { learner } = useSession();
  const record = useFinishRecord(lesson.id);
  const progress = useSeriesProgress(lesson);
  const next = lesson.next;

  // No record of finishing in this visit (the page was refreshed, or opened
  // directly). Only what the bag has saved can still be shown.
  const savedBefore = !record && progress.known && progress.own !== null && progress.own.state === 'finished';
  if (!record && learner && !progress.known) return <LoadingState label="Opening…" />;
  if (!record && !savedBefore) {
    return (
      <Message
        tone="info"
        title="This lesson is not finished yet"
        action={
          <ButtonLink to={paths.lesson(lesson.id)} fullWidth>
            Open the lesson
          </ButtonLink>
        }
      >
        Open it and go to the end.
      </Message>
    );
  }

  let result: QuizResult | null = record ? record.result : null;
  if (!result && savedBefore && progress.own && progress.own.correct !== null && progress.own.total !== null) {
    result = { correct: progress.own.correct, total: progress.own.total, answers: [] };
  }
  const count = lesson.position === null ? null : Math.max(lesson.series.lessonCount, lesson.position);
  const topic = lesson.portal.groupKind === 'topic' ? lesson.group.title : lesson.series.title;

  return (
    <div className="les-page les-done">
      <section className="sb-card sb-card--lg sb-card--tappable" role="status" aria-labelledby={TITLE_ID}>
        <ScenePicture picture={lesson.picture} shape="header" eager />
        <div className="les-done__body">
          <Badge size="lg" overlap tone="success" className="les-done__badge">
            <IconTick size={40} />
          </Badge>
          <p className="les-done__well">Well done!</p>
          <h1 id={TITLE_ID} className="les-done__title">
            You finished {lesson.title}!
          </h1>
          <p className="les-done__place">
            {topic} · {count === null ? 'Quiz' : `Lesson ${lesson.position} of ${count}`}
          </p>
          <ListenBar src={lesson.listenUrl} />
        </div>
      </section>

      {result ? <QuizScore result={result} /> : null}

      {record ? (
        <SaveNote lessonId={lesson.id} />
      ) : (
        <SuccessState title={`Saved for ${learner ? learner.name : 'you'}`} className="les-save">
          Your progress stays in this bag.
        </SuccessState>
      )}

      <SeriesDone lesson={lesson} progress={progress} />

      {next ? (
        <ButtonLink to={paths.lesson(next.id)} size="lg" fullWidth className="les-done__next" icon={<IconNext size={38} />}>
          <span className="les-done__next-small">{next.type === 'check' ? 'Next: the quiz' : 'Next lesson'}</span>
          <span className="les-done__next-title">{next.title}</span>
        </ButtonLink>
      ) : null}
      <FinishedActions lesson={lesson} withoutNext />
      <HelpCard lesson={lesson} />
    </div>
  );
}

export default function LessonDoneScreen() {
  const { lessonId } = useParams<'lessonId'>();
  const { data: lesson, error, loading, reload } = useApi((signal) => learnerApi.getLesson(lessonId, { signal }), [lessonId]);
  return (
    <PageShell
      title={lesson ? `Finished: ${lesson.title}` : 'Finished'}
      theme={lesson ? lesson.portal.theme : undefined}
      backTo={lesson ? seriesPath(lesson) : paths.home()}
      quickExit={lesson ? isChildProtection(lesson) : false}
      listenSrc={lesson ? lesson.listenUrl : null}
    >
      {loading && !lesson ? <LoadingState label="Opening…" /> : null}
      {error ? (
        <ErrorState
          title="This page did not open"
          error={error}
          onRetry={reload}
          action={
            <ButtonLink to={paths.home()} variant="secondary" fullWidth icon={<IconHome size={28} />}>
              Go to Home
            </ButtonLink>
          }
        />
      ) : null}
      {lesson && !error ? <DoneBody key={lesson.id} lesson={lesson} /> : null}
    </PageShell>
  );
}
