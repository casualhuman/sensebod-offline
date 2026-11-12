/*
 * Lesson players: route table (stream 3).
 *
 * This file is the only thing the app router knows about this feature.
 * Add one line per screen to `routes`; see README.md in this folder.
 * The placeholder below shows the conventions in working form: replace it.
 */
import { getLesson } from '@shared/api/learner';
import { useApi } from '@shared/api';
import { ErrorState, FactsRow, LessonHeaderPill, LoadingState, lessonPositionLabel, Message } from '@shared/components';
import { paths, useParams, type RouteDef } from '@shared/router';
import { ListenBar, PageShell } from '@shared/shell';

/** Placeholder for every lesson type. Stream 3 replaces this with the players. */
function LessonPlaceholder() {
  const { lessonId } = useParams<'lessonId'>();
  const { data: lesson, error, loading, reload } = useApi((signal) => getLesson(lessonId, { signal }), [lessonId]);
  const backTo = lesson ? paths.series(lesson.portal.id, lesson.group.id, lesson.series.id) : paths.home();
  return (
    <PageShell
      title={lesson ? lesson.title : 'Lesson'}
      theme={lesson?.portal.theme}
      backTo={backTo}
      quickExit={lesson?.portal.id === 'child-protection'}
      listenSrc={lesson?.listenUrl ?? null}
    >
      {loading && !lesson ? <LoadingState label="Opening the lesson…" /> : null}
      {error ? <ErrorState title="This lesson did not open" error={error} onRetry={reload} /> : null}
      {lesson ? (
        <div className="sb-stack">
          <LessonHeaderPill type={lesson.type} detail={lessonPositionLabel(lesson)} />
          <h1 className="sb-h1">{lesson.title}</h1>
          <FactsRow tag={lesson} />
          <ListenBar src={lesson.listenUrl} />
          <Message tone="info" title="Player not built yet">
            The {lesson.type} player is built by stream 3.
          </Message>
        </div>
      ) : null}
    </PageShell>
  );
}

export const routes: RouteDef[] = [
  { path: '/lesson/:lessonId', component: LessonPlaceholder },
  // { path: '/lesson/:lessonId/done', component: lazy(() => import('./screens/LessonDone')) },
];
