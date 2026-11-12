/*
 * The three kinds of portal page:
 *   - WhoAreYou      Child protection: choose an audience (CPB-Who, CPB-Who-Tab)
 *   - TopicPortal    Agriculture and Climate: topics (AGB-Agriculture, CLB-Climate)
 *   - ClassPortal    Primary and JSS: class, then subjects (V3-Primary, V3-JSS)
 */
import { useEffect, useRef } from 'react';
import { learnerApi, useApi, type Group, type GroupDetail, type PortalDetail, type SeriesSummary } from '@shared/api';
import { Badge, Card, EmptyState, ErrorState, InfoStrip, LessonCard, LoadingState, ScenePicture, TagLine, TopicCard } from '@shared/components';
import { IconArrowRight, IconLeave, IconLock, IconTick } from '@shared/icons';
import { Link, navigate, paths } from '@shared/router';
import { ListenBar, PageShell } from '@shared/shell';
import { ContinueCard, HelpCard, Hero, LearnerStrip, SectionHeading } from '../components';
import { AudienceIcon, PortalIcon, TopicIcon } from '../icons';
import { count, splitClassTitle } from '../lib';
import { listProgress, useContinueLesson, useProgress, type ProgressIndex } from '../progress';

/** A group with one series opens its lesson list directly (API-CONTRACT section 3). */
function groupPath(group: Group): string {
  return group.onlySeriesId ? paths.series(group.portalId, group.id, group.onlySeriesId) : paths.group(group.portalId, group.id);
}

/* ------------------------------------------------------------------ */
/* Child protection: Who are you?                                      */
/* ------------------------------------------------------------------ */

/*
 * TODO(stream-1): the shared PortalCard always says "Open"; CPB-Who needs
 * "This is me" and a wider layout on tablets. Built here from the shared
 * Card, ScenePicture and Badge until PortalCard takes an action label
 * (docs/team/REQUESTS.md).
 */
function AudienceCard({ group, eager }: { group: Group; eager: boolean }) {
  const unavailable = group.availability === 'not-in-bag';
  return (
    <Card to={unavailable ? undefined : groupPath(group)} unavailable={unavailable} large className="lrn-audience">
      <ScenePicture picture={group.picture} eager={eager} className="lrn-audience__picture" />
      <span className="sb-card__body lrn-audience__body">
        <Badge size="lg" overlap tone={unavailable ? 'muted' : 'accent'}>
          <AudienceIcon group={group} size={40} />
        </Badge>
        <span className="lrn-audience__words">
          <span className="sb-portal-card__title">{group.title}</span>
          <span className="sb-portal-card__text">{unavailable ? 'Not in this bag yet. Ask your facilitator.' : group.description}</span>
        </span>
        {unavailable ? null : (
          <span className="sb-open-pill lrn-audience__pill">
            This is me
            <IconArrowRight size={24} />
          </span>
        )}
      </span>
    </Card>
  );
}

export function WhoAreYou({ portal }: { portal: PortalDetail }) {
  return (
    <PageShell title="Who are you?" backTo={paths.home()} quickExit listenSrc={portal.listenUrl}>
      <div className="sb-stack sb-stack--lg">
        <div className="lrn-note">
          <IconLeave size={32} />
          <p>
            <strong>Leave this page</strong> (top right): tap to go back to the home page quickly.
          </p>
        </div>

        <section className="lrn-intro">
          <p className="lrn-eyebrow">{portal.title}</p>
          <h1 className="sb-h1 lrn-h1-lg">Who are you?</h1>
          <p className="sb-body sb-muted">Tap the picture that is you.</p>
          <ListenBar src={portal.listenUrl} className="lrn-listen lrn-gap-top" />
        </section>

        <InfoStrip icon={<IconLock size={36} />}>
          You can change this any time. <strong>Nobody else can see your answer.</strong>
        </InfoStrip>

        <section aria-labelledby="lrn-choose" className="sb-stack">
          <h2 id="lrn-choose" className="sb-h2">
            Choose one
          </h2>
          {portal.groups.length === 0 ? <EmptyState>These lessons are not in this bag yet. Ask your facilitator.</EmptyState> : null}
          <div className="lrn-stack-cards">
            {portal.groups.map((group, index) => (
              <AudienceCard key={group.id} group={group} eager={index === 0} />
            ))}
          </div>
        </section>

        <HelpCard title="Need help now?" text="See who can help you today." />
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Agriculture and Climate: topics                                     */
/* ------------------------------------------------------------------ */

function isWatchOnly(group: Group): boolean {
  return group.lessonTypes.length === 1 && group.lessonTypes[0] === 'watch';
}

function TopicGroupCard({ group, index }: { group: Group; index: ProgressIndex | null }) {
  const available = group.availability !== 'not-in-bag';
  const progress = listProgress(index, group.onlySeriesId, group.lessonCount, available);
  const watchOnly = isWatchOnly(group);
  return (
    <TopicCard
      to={available ? groupPath(group) : undefined}
      title={group.title}
      picture={group.picture}
      icon={<TopicIcon title={group.title} portalId={group.portalId} watchOnly={watchOnly} />}
      state={progress.state}
      tag={watchOnly ? <TagLine type="watch" detail={count(group.lessonCount, 'video', 'videos')} /> : undefined}
      detail={progress.state === 'not-started' || progress.state === 'not-in-bag' ? group.description : undefined}
      done={progress.done}
      total={progress.total}
    />
  );
}

export function TopicPortal({ portal }: { portal: PortalDetail }) {
  const progress = useProgress({ portalId: portal.id });
  const continueItem = useContinueLesson(portal.id);
  const available = portal.groups.filter((group) => group.availability !== 'not-in-bag');
  const allVideos = available.length > 0 && available.every(isWatchOnly);
  const videoCount = available.reduce((total, group) => total + group.lessonCount, 0);

  return (
    <PageShell title={portal.title} theme={portal.theme} backTo={paths.home()} listenSrc={portal.listenUrl}>
      <div className="sb-stack sb-stack--lg">
        <div className="sb-stack">
          <Hero title={portal.title} description={portal.description} picture={portal.picture} pictureShape="portal" icon={<PortalIcon portalId={portal.id} size={42} />} listenSrc={portal.listenUrl} />
          <LearnerStrip className="lrn-narrow" />
        </div>

        {continueItem ? <ContinueCard item={continueItem} /> : null}

        <section aria-labelledby="lrn-topics" className="sb-stack">
          <SectionHeading id="lrn-topics" title="Choose a topic" text={allVideos ? 'All topics here are videos to watch.' : undefined} />
          {portal.groups.length === 0 ? <EmptyState>These lessons are not in this bag yet. Ask your facilitator.</EmptyState> : null}
          <div className="sb-grid">
            {portal.groups.map((group) => (
              <TopicGroupCard key={group.id} group={group} index={progress.index} />
            ))}
          </div>
        </section>

        <InfoStrip>
          {allVideos ? (
            <>
              {count(videoCount, 'video is', 'videos are')} in this bag. <strong>No internet needed.</strong>
            </>
          ) : undefined}
        </InfoStrip>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Primary and JSS: class, then subjects                               */
/* ------------------------------------------------------------------ */

/** Set when a class is tapped, so the subjects are brought into view once they load. */
let showSubjectsNext = false;

function ClassPicker({ portal, selectedId }: { portal: PortalDetail; selectedId: string | null }) {
  return (
    <ul className={portal.groups.length <= 3 ? 'lrn-classes lrn-classes--3' : 'lrn-classes'} aria-label="Choose your class">
      {portal.groups.map((group) => {
        const { word, number } = splitClassTitle(group.title);
        const selected = group.id === selectedId;
        const to = paths.group(portal.id, group.id);
        if (group.availability === 'not-in-bag') {
          return (
            <li key={group.id}>
              <span className="lrn-class lrn-class--unavailable" role="group" aria-label={`${group.title}, not in this bag`} aria-disabled="true">
                {word ? <span className="lrn-class__word">{word}</span> : null}
                <span className={word ? 'lrn-class__number' : 'lrn-class__name'}>{number}</span>
                <span className="lrn-class__note">Not in this bag</span>
              </span>
            </li>
          );
        }
        return (
          <li key={group.id}>
            <Link
              to={to}
              className="lrn-class"
              // The word and the number are separate boxes: name the link as one phrase.
              aria-label={selected ? `${group.title}, your class` : group.title}
              aria-current={selected ? 'true' : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                // Stay where the learner is looking: the subjects appear below.
                event.preventDefault();
                showSubjectsNext = true;
                navigate(to, { keepScroll: true, replace: selectedId !== null });
              }}
            >
              {selected ? (
                <span className="lrn-class__tick" aria-hidden="true">
                  <IconTick size={22} strokeWidth={3.4} />
                </span>
              ) : null}
              {word ? <span className="lrn-class__word">{word}</span> : null}
              <span className={word ? 'lrn-class__number' : 'lrn-class__name'}>{number}</span>
              {selected ? <span className="lrn-class__note">Your class</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function subjectDetail(series: SeriesSummary, state: string, done: number): string | undefined {
  const total = series.lessonCount;
  if (state === 'not-in-bag') return series.description || 'Not in this bag yet. Ask your teacher.';
  if (total === 0) return 'No lessons yet. Ask your teacher.';
  if (state === 'finished') return `All ${count(total, 'lesson', 'lessons')} done. Well done!`;
  if (state === 'started') return `Lesson ${Math.min(done + 1, total)} of ${total}`;
  return `Start at Lesson 1 of ${total}`;
}

/** Subject (series) cards of a class, or the series of any group that has more than one. */
export function SeriesCards({ group, index }: { group: GroupDetail; index: ProgressIndex | null }) {
  if (group.series.length === 0) {
    return <EmptyState>{group.kind === 'class' ? 'There are no subjects for this class in this bag yet. Ask your teacher.' : 'These lessons are not in this bag yet. Ask your facilitator.'}</EmptyState>;
  }
  return (
    <div className="sb-grid">
      {group.series.map((series) => {
        const available = series.availability !== 'not-in-bag';
        const progress = listProgress(index, series.id, series.lessonCount, available);
        return (
          <TopicCard
            key={series.id}
            to={available ? paths.series(series.portalId, series.groupId, series.id) : undefined}
            title={series.title}
            picture={series.picture}
            icon={<TopicIcon title={series.title} portalId={series.portalId} />}
            state={progress.state}
            detail={subjectDetail(series, progress.state, progress.done)}
            done={progress.done}
            total={progress.total}
          />
        );
      })}
    </div>
  );
}

/*
 * TODO(stream-1): a series summary says it has a quiz (`hasQuiz`) but not
 * which lesson it is, so the quiz entry needs one extra request per subject
 * that has one (docs/team/REQUESTS.md "quiz lesson on SeriesSummary").
 * If that request fails the entry is simply not shown: the quiz is still the
 * last card of the subject's lesson list.
 */
function PracticeQuizzes({ group, index }: { group: GroupDetail; index: ProgressIndex | null }) {
  const ids = group.series.filter((series) => series.hasQuiz && series.availability !== 'not-in-bag').map((series) => series.id);
  const key = ids.join(',');
  const { data } = useApi(
    (signal) => Promise.all(ids.map((id) => learnerApi.getSeries(id, { signal }))),
    [key],
  );
  if (!data) return null;
  const quizzes = data
    // Ignore an answer that belongs to the class shown before this one.
    .filter((series) => ids.indexOf(series.id) !== -1)
    .map((series) => ({ series, lesson: series.lessons.filter((lesson) => lesson.type === 'check')[0] }))
    .filter((item) => item.lesson !== undefined);
  if (quizzes.length === 0) return null;
  return (
    <section aria-labelledby="lrn-quiz" className="sb-stack">
      <SectionHeading id="lrn-quiz" title="Check what you learned" />
      <div className="sb-grid">
        {quizzes.map(({ series, lesson }) =>
          lesson ? (
            <LessonCard
              key={lesson.id}
              lesson={lesson.summary ? lesson : { ...lesson, summary: `${series.title} · ${group.title}` }}
              to={paths.lesson(lesson.id)}
              state={(index && index.byLesson.get(lesson.id)) || 'not-started'}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

const CLASS_WORDS: Record<string, { title: string; text: string; subjects: string }> = {
  primary: { title: 'Which class are you in?', text: 'Tap your class.', subjects: 'Tap a subject to start.' },
  jss: { title: 'Choose your class', text: 'Tap the class you are in.', subjects: 'Choose a subject to study.' },
};

export interface ClassPortalProps {
  portal: PortalDetail;
  /** The class from the URL, or null on the portal page itself. */
  groupId: string | null;
}

export function ClassPortal({ portal, groupId }: ClassPortalProps) {
  const words = CLASS_WORDS[portal.id] ?? (CLASS_WORDS.jss as { title: string; text: string; subjects: string });
  const progress = useProgress({ portalId: portal.id });
  const continueItem = useContinueLesson(portal.id);
  const group = useApi((signal) => (groupId ? learnerApi.getGroup(groupId, { signal }) : Promise.resolve(null)), [groupId]);
  const subjectsRef = useRef<HTMLDivElement>(null);
  const selected = portal.groups.filter((item) => item.id === groupId)[0];
  const loaded = group.data && group.data.id === groupId ? group.data : null;

  // After a class is tapped, bring its subjects into view and move focus to
  // their heading, so the result of the tap is seen and announced.
  useEffect(() => {
    if (!loaded || !showSubjectsNext) return;
    showSubjectsNext = false;
    const node = subjectsRef.current;
    if (!node) return;
    if (node.scrollIntoView) node.scrollIntoView();
    const heading = node.querySelector('h2');
    if (heading) heading.focus();
  }, [loaded]);

  const title = selected ? `${selected.title} · ${portal.title}` : portal.title;
  return (
    <PageShell title={title} theme={portal.theme} backTo={groupId ? paths.portal(portal.id) : paths.home()} listenSrc={portal.listenUrl}>
      <div className="sb-stack sb-stack--lg">
        <div className="sb-stack">
          <Hero title={portal.title} description={portal.description} picture={portal.picture} pictureShape="portal" icon={<PortalIcon portalId={portal.id} size={42} />} listenSrc={portal.listenUrl} />
          <LearnerStrip className="lrn-narrow" />
        </div>

        {continueItem ? <ContinueCard item={continueItem} /> : null}

        <section aria-labelledby="lrn-step1" className="sb-stack">
          <SectionHeading id="lrn-step1" step="Step 1 of 2" title={words.title} text={words.text} />
          {portal.groups.length === 0 ? <EmptyState>There are no classes in this bag yet. Ask your teacher.</EmptyState> : <ClassPicker portal={portal} selectedId={groupId} />}
        </section>

        {groupId ? (
          <section aria-labelledby="lrn-step2" className="sb-stack lrn-anchor" ref={subjectsRef}>
            <SectionHeading id="lrn-step2" step="Step 2 of 2" title={`${selected ? selected.title : 'Your class'} subjects`} text={words.subjects} focusable />
            {group.loading && !loaded ? <LoadingState label="Opening the subjects…" /> : null}
            {group.error ? <ErrorState title="The subjects did not open" error={group.error} onRetry={group.reload} /> : null}
            {loaded ? <SeriesCards group={loaded} index={progress.index} /> : null}
          </section>
        ) : null}

        {loaded ? <PracticeQuizzes group={loaded} index={progress.index} /> : null}

        <InfoStrip>
          These lessons are in this bag. <strong>No internet needed.</strong>
        </InfoStrip>
      </div>
    </PageShell>
  );
}
