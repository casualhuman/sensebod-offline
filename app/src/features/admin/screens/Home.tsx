/*
 * Admin home (ADM-M-Home): the four sources, drafts waiting to be placed,
 * what was published lately, storage, and the way to the full admin.
 */
import { adminApi, ApiError, type AdminLesson } from '@shared/api';
import { ButtonLink, EmptyState, ErrorState, formatLength, LESSON_TYPES, LessonTypeIcon, LoadingState } from '@shared/components';
import { IconArrowRight, IconChevronRight, IconTick } from '@shared/icons';
import { Link } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { PageHead, StatusChip } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconLaptop, IconStorage } from '../icons';
import { classifyFileName, formatBytes } from '../lib/files';
import { recentPublishedIds } from '../lib/flow';
import { useAdminApi, useAdminSession } from '../session';
import { SourceCards } from './SourceCards';
import './home.css';

/** "Voice note · 1:42", "3 photo pages": what the draft was made from. */
export function draftDetail(lesson: AdminLesson): string {
  const parts: string[] = [];
  if (lesson.source === 'notes-photos') parts.push(lesson.pages === 1 ? '1 photo page' : `${lesson.pages ?? '[pages]'} photo pages`);
  else if (lesson.source === 'typed') parts.push('Typed text');
  else if (lesson.source === 'animation') parts.push('Animation package');
  else if (lesson.source === 'questions') parts.push('Quiz');
  else if (lesson.fileNames[0]) parts.push(classifyFileName(lesson.fileNames[0]).label);
  if (lesson.length !== null) parts.push(formatLength(lesson.length));
  return parts.join(' · ');
}

function WaitingList({ drafts }: { drafts: AdminLesson[] }) {
  return (
    <ul className="adm-list">
      {drafts.map((lesson) => (
        <li key={lesson.id} className="adm-card">
          <div className="adm-row adm-row--top">
            <span className="adm-disc" aria-hidden="true">
              <LessonTypeIcon type={lesson.type} size={26} />
            </span>
            <div className="adm-row__grow adm-stack--sm">
              <p className="adm-small">
                <strong className="adm-strong">{LESSON_TYPES[lesson.type].label}</strong>
                {draftDetail(lesson) ? ` · ${draftDetail(lesson)}` : ''}
              </p>
              <p className="adm-card__title">{lesson.title}</p>
              <StatusChip status="draft" placed={false} />
            </div>
          </div>
          <ButtonLink to={adminPaths.place(lesson.id)} variant="secondary" size="sm" fullWidth className="adm-home__place" aria-label={`Choose portal for ${lesson.title}`}>
            Choose portal
          </ButtonLink>
        </li>
      ))}
    </ul>
  );
}

function RecentList() {
  const ids = recentPublishedIds().slice(0, 3);
  const { data, loading, error, reload } = useAdminApi(
    (signal) =>
      // A lesson that was deleted since is simply left out.
      Promise.all(ids.map((id) => adminApi.getAdminLesson(id, { signal }).catch((failure: unknown) => (failure instanceof ApiError && failure.status === 404 ? null : Promise.reject(failure))))),
    [ids.join(',')],
  );
  if (ids.length === 0) {
    return (
      <EmptyState title="Nothing published from this phone yet">
        Lessons you publish show here. <Link to={adminPaths.library()}>See everything in the Library</Link>
      </EmptyState>
    );
  }
  if (loading && !data) return <LoadingState label="Looking for your latest lessons…" />;
  if (error && !data) return <ErrorState title="The latest lessons did not load" error={error} onRetry={reload} />;
  const lessons = (data ?? []).filter((lesson): lesson is AdminLesson => lesson !== null && lesson.status === 'published');
  if (lessons.length === 0) return <EmptyState title="Nothing published from this phone yet">Lessons you publish show here.</EmptyState>;
  return (
    <ul className="adm-list">
      {lessons.map((lesson) => (
        <li key={lesson.id} className="adm-card">
          <div className="adm-row adm-row--top">
            <span className="adm-disc" aria-hidden="true">
              <LessonTypeIcon type={lesson.type} size={26} />
            </span>
            <div className="adm-row__grow adm-stack--sm">
              <p className="adm-card__title">{lesson.title}</p>
              <p className="adm-small">
                <strong className="adm-strong">{LESSON_TYPES[lesson.type].label}</strong>
                {lesson.placementLabel ? ` · ${lesson.placementLabel}` : ''}
              </p>
              <p className="adm-note adm-note--ok">
                <IconTick size={20} />
                <span>Published · learners can see it</span>
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StorageCard() {
  const { data, error, loading } = useAdminApi((signal) => adminApi.getStorage({ signal }), []);
  // Storage is extra information: if it cannot be read the card is left out rather than blocking Home.
  if (error || (loading && !data) || !data) return null;
  const known = data.breakdown.find((part) => part.bytes !== null);
  const used = data.usedBytes === null ? '[used]' : (data.usedBytes / 1024 ** 3).toFixed(1);
  const total = data.totalBytes === null ? '[total]' : (data.totalBytes / 1024 ** 3).toFixed(1);
  return (
    <section aria-label="Storage" className="adm-card adm-stack--sm">
      <p className="adm-row adm-card__title">
        <IconStorage size={26} />
        <span>
          {used} of {total} GB used on this bag
        </span>
      </p>
      {known ? (
        <p className="adm-small">
          {known.label} use {formatBytes(known.bytes)} of it.
        </p>
      ) : null}
    </section>
  );
}

export default function Home() {
  const { session } = useAdminSession();
  const waiting = useAdminApi((signal) => adminApi.getLibrary({ unplaced: true, pageSize: 50 }, { signal }), []);
  const drafts = waiting.data ? waiting.data.items : [];
  const first = drafts[0];

  return (
    <AdminFrame
      title="Admin home"
      nav="home"
      action={
        first ? (
          <ButtonLink to={adminPaths.place(first.id)} fullWidth iconAfter={<IconArrowRight size={26} />}>
            {drafts.length === 1 ? 'Place 1 waiting lesson' : `Place ${waiting.data ? waiting.data.total : drafts.length} waiting lessons`}
          </ButtonLink>
        ) : undefined
      }
    >
      <PageHead title={`Hello, ${session ? session.displayName : ''}`} lead="Add a lesson, then choose where learners will find it." />

      <section aria-labelledby="adm-add-h" className="adm-stack">
        <div>
          <h2 id="adm-add-h" className="adm-h2">
            Add content
          </h2>
          <p className="adm-lead">Where is it coming from?</p>
        </div>
        <SourceCards />
      </section>

      <section aria-labelledby="adm-wait-h" className="adm-stack">
        <div className="adm-row adm-row--between">
          <h2 id="adm-wait-h" className="adm-h2">
            Waiting to be placed
          </h2>
          {waiting.data ? (
            <span className="adm-chip adm-chip--count">
              {waiting.data.total}
              <span className="sb-visually-hidden"> waiting</span>
            </span>
          ) : null}
        </div>
        {waiting.loading && !waiting.data ? (
          <LoadingState label="Looking for drafts…" />
        ) : waiting.error && !waiting.data ? (
          <ErrorState title="The drafts did not load" error={waiting.error} onRetry={waiting.reload} />
        ) : drafts.length === 0 ? (
          <EmptyState title="Nothing is waiting">Every lesson you added is on a portal. Add content above to make a new one.</EmptyState>
        ) : (
          <>
            <p className="adm-small">Learners cannot see these yet.</p>
            <WaitingList drafts={drafts} />
          </>
        )}
      </section>

      <section aria-labelledby="adm-pub-h" className="adm-stack">
        <h2 id="adm-pub-h" className="adm-h2">
          Recently published
        </h2>
        <RecentList />
        <Link to={adminPaths.library()} className="adm-link-btn">
          See everything in the Library
          <IconChevronRight size={20} />
        </Link>
      </section>

      <StorageCard />

      <Link to={adminPaths.library()} className="adm-card adm-card--dashed adm-home__laptop">
        <IconLaptop size={28} />
        <span>
          <span className="adm-home__laptop-title">Open full admin on a laptop</span>
          <span className="adm-small" style={{ display: 'block' }}>
            For quizzes, questions in videos and series order
          </span>
        </span>
      </Link>
    </AdminFrame>
  );
}
