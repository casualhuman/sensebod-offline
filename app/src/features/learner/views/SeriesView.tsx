/*
 * The lesson list of a series (boards: CPB-Child, CPB-Parent, CPB-Elder,
 * CPB-Child-Tab). The same screen serves every portal: an Agriculture topic,
 * a Climate topic and a school subject are series too, and have no board of
 * their own for this step.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FilterableLessonType, LessonSummary, ProgressState, SeriesDetail } from '@shared/api';
import {
  Button,
  ButtonLink,
  EmptyState,
  FILTER_TYPES,
  filterLessons,
  LESSON_TYPES,
  LessonCard,
  LessonFilter,
  Message,
  PersonChip,
  ProgressSteps,
  ProgressTrack,
  summariseStates,
  type LessonFilterValue,
} from '@shared/components';
import { IconBack, IconFinished, IconTryAgain } from '@shared/icons';
import { paths } from '@shared/router';
import { setChildProtectionAudience } from '@shared/session';
import { PageShell } from '@shared/shell';
import { Hero, LearnerStrip, SectionHeading, shellPropsFor } from '../components';
import { AudienceIcon, PortalIcon, TopicIcon } from '../icons';
import { CHILD_PROTECTION, count, describeLessonTypes } from '../lib';
import { lessonState, useProgress } from '../progress';
import { AudienceExtras } from './ChildProtectionExtras';

/** One segment per lesson reads well up to here; longer series get one bar. */
const MAX_STEPS = 8;

function stepsLabel(states: readonly ProgressState[]): string {
  const words: Record<ProgressState, string> = { finished: 'finished', started: 'started', 'not-started': 'not started' };
  return states.map((state, index) => `Lesson ${index + 1} ${words[state]}.`).join(' ');
}

function ProgressPanel({ states }: { states: readonly ProgressState[] }) {
  const finished = states.filter((state) => state === 'finished').length;
  const words = `You finished ${finished} of ${count(states.length, 'lesson', 'lessons')}`;
  return (
    <section aria-label="Your progress" className="lrn-progress-panel">
      <p className="lrn-progress-panel__words">
        <IconFinished size={30} />
        {words}
      </p>
      {states.length <= MAX_STEPS ? <ProgressSteps states={states} label={stepsLabel(states)} /> : <ProgressTrack done={finished} total={states.length} label={words} />}
      <p className="sb-label lrn-semibold sb-muted">{summariseStates(states)}</p>
    </section>
  );
}

function shownWords(filter: LessonFilterValue, lessons: readonly LessonSummary[]): string {
  const quiz = lessons.some((lesson) => lesson.type === 'check');
  const n = lessons.filter((lesson) => lesson.type !== 'check').length;
  const kind = filter === 'all' ? count(n, 'lesson', 'lessons') : `${count(n, 'lesson', 'lessons')} to ${LESSON_TYPES[filter].label.toLowerCase()}`;
  return `Showing ${kind}${quiz ? ' and the quiz' : ''}.`;
}

export interface SeriesViewProps {
  series: SeriesDetail;
  /** Where Back goes: the subject list of a class, or the portal page. */
  backTo: string;
}

export function SeriesView({ series, backTo }: SeriesViewProps) {
  const { portal, group } = series;
  const sensitive = portal.id === CHILD_PROTECTION;
  const [filter, setFilter] = useState<LessonFilterValue>('all');
  const progress = useProgress({ seriesId: series.id });

  // Remembered for the "You chose" row and the Back target of Get help now;
  // "Leave this page" forgets it again.
  useEffect(() => {
    if (sensitive) setChildProtectionAudience(group.id);
  }, [sensitive, group.id]);

  const lessons = series.lessons;
  const types = useMemo<FilterableLessonType[]>(() => FILTER_TYPES.filter((type) => lessons.some((lesson) => lesson.type === type)), [lessons]);
  // A filter that no longer matches anything (the list changed) falls back to All.
  const activeFilter: LessonFilterValue = filter !== 'all' && types.indexOf(filter) === -1 ? 'all' : filter;
  const shown = filterLessons(lessons, activeFilter);
  const numbered = lessons.filter((lesson) => lesson.type !== 'check');
  const states = numbered.map((lesson) => lessonState(progress.index, lesson.id));
  const empty = lessons.length === 0 || series.availability === 'not-in-bag';

  const icon = sensitive ? (
    <AudienceIcon group={group} size={28} />
  ) : group.kind === 'class' ? (
    <TopicIcon title={series.title} portalId={portal.id} size={28} />
  ) : (
    <PortalIcon portalId={portal.id} size={28} />
  );

  return (
    <PageShell title={series.title} heading={series.title} backTo={backTo} listenSrc={series.listenUrl} {...shellPropsFor(portal.id)} theme={portal.theme}>
      <div className="sb-stack sb-stack--lg">
        <div className="sb-stack">
          <Hero
            description={series.description || (group.kind === 'class' ? group.title : undefined)}
            eyebrow={group.kind === 'class' ? `${portal.title} · ${group.title}` : portal.title}
            picture={series.picture}
            icon={icon}
            listenSrc={series.listenUrl}
          />
          {sensitive ? (
            <PersonChip icon={<AudienceIcon group={group} size={28} />} changeTo={paths.portal(portal.id)} className="lrn-narrow">
              You chose: <strong>{group.title}</strong>
            </PersonChip>
          ) : (
            <LearnerStrip className="lrn-narrow" />
          )}
        </div>

        {empty ? (
          <EmptyState
            action={
              <ButtonLink to={backTo} fullWidth icon={<IconBack size={28} />}>
                Go back
              </ButtonLink>
            }
          >
            {series.description && series.availability === 'not-in-bag' ? series.description : 'These lessons are not in this bag yet. Ask your facilitator.'}
          </EmptyState>
        ) : (
          <section aria-labelledby="lrn-lessons" className="sb-stack">
            <SectionHeading id="lrn-lessons" title="Your lessons" text={describeLessonTypes(types)} />
            {types.length > 1 ? <LessonFilter value={activeFilter} onChange={setFilter} types={types} /> : null}
            {progress.index ? <ProgressPanel states={states} /> : null}
            {progress.error ? (
              <Message
                tone="info"
                title="Your progress did not load"
                action={
                  <Button variant="secondary" fullWidth icon={<IconTryAgain size={28} />} onClick={progress.reload}>
                    Try again
                  </Button>
                }
              >
                The lessons below still work. Nothing is lost.
              </Message>
            ) : null}
            <p className="sb-visually-hidden" role="status">
              {activeFilter === 'all' ? '' : shownWords(activeFilter, shown)}
            </p>
            <div className="sb-grid">
              {shown.map((lesson, index) => (
                <LessonCard key={lesson.id} lesson={lesson} to={paths.lesson(lesson.id)} state={lessonState(progress.index, lesson.id)} eager={index === 0} />
              ))}
            </div>
          </section>
        )}

        {sensitive ? <AudienceExtras group={group} /> : null}
      </div>
    </PageShell>
  );
}
