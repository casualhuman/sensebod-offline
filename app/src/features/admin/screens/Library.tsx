/*
 * Library (ADM-Library): every lesson on the bag, by portal, with filters,
 * a search and the per-lesson actions. A table on a laptop; the same rows
 * read as cards on a phone (CSS only, one set of markup).
 */
import { useState, type FormEvent } from 'react';
import { adminApi, learnerApi, type AdminLesson, type LessonType, type PortalId, type PublishStatus } from '@shared/api';
import { Button, ButtonLink, EmptyState, ErrorState, formatLength, formatPages, Illustration, LESSON_TYPES, LessonTypeIcon, LoadingState, YouTakePart } from '@shared/components';
import { IconArrowRight, IconInfoMark, IconLock, IconPencil, IconPlus, IconQuestion, IconTrash, IconTryIt, IconUpload } from '@shared/icons';
import { Link, navigate, paths, useLocation } from '@shared/router';
import { adminPaths, type LibraryLinkQuery } from '../adminPaths';
import { ConfirmAction, InputField, PageHead, SelectField, StatusChip } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconEye, IconMore, IconSearch, IconSeriesOrder } from '../icons';
import { forgetPublished, rememberPublished } from '../lib/flow';
import { useAction } from '../lib/hooks';
import { useAdminApi } from '../session';
import './library.css';
import './place.css';

const PAGE_SIZE = 25;
const PORTAL_IDS: PortalId[] = ['primary', 'jss', 'child-protection', 'agriculture', 'climate'];
const TYPES: (LessonType | 'all')[] = ['all', 'watch', 'listen', 'read', 'try', 'check'];

function asPortalId(value: string | null): PortalId | undefined {
  return PORTAL_IDS.indexOf(value as PortalId) === -1 ? undefined : (value as PortalId);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '[date]';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function lengthWords(lesson: AdminLesson): string {
  if (lesson.type === 'check') return lesson.questionCount === 1 ? '1 question' : `${lesson.questionCount ?? '[n]'} questions`;
  if (lesson.type === 'read') return formatPages(lesson.pages);
  if (lesson.type === 'try') return 'Interactive';
  return formatLength(lesson.length);
}

const LANGUAGES: Record<string, string> = { en: 'English', kri: 'Krio', es: 'Spanish', hi: 'Hindi' };

function LessonRow({ lesson, onChanged }: { lesson: AdminLesson; onChanged: () => void }) {
  const [more, setMore] = useState(false);
  const toggle = useAction(async () => {
    if (lesson.status === 'published') {
      await adminApi.unpublishLesson(lesson.id);
      forgetPublished(lesson.id);
    } else {
      await adminApi.publishLesson(lesson.id);
      rememberPublished(lesson.id);
    }
    onChanged();
  });
  const remove = useAction(async () => {
    await adminApi.deleteLesson(lesson.id);
    forgetPublished(lesson.id);
    onChanged();
  });
  const error = toggle.error ?? remove.error;

  return (
    <>
      <tr>
        <td data-label="Order" className="adm-lib__order">
          {lesson.type === 'check' ? 'Quiz · always last' : (lesson.position ?? '—')}
        </td>
        <td className="adm-lib__cover">
          <span className="adm-thumb">{lesson.picture ? <Illustration src={lesson.picture.url} alt="" /> : null}</span>
        </td>
        <td>
          <strong className="adm-lib__title">{lesson.title}</strong>
          {lesson.summary ? <span className="adm-small adm-lib__line">{lesson.summary}</span> : null}
          {!lesson.placement ? <span className="adm-small adm-lib__line">Not on a portal yet</span> : null}
          {lesson.status === 'draft' ? (
            <span className="adm-small adm-lib__line">
              <IconLock size={16} /> Learners cannot see this yet
            </span>
          ) : null}
        </td>
        <td data-label="Type">
          <span className="adm-chip">
            <LessonTypeIcon type={lesson.type} size={18} />
            {LESSON_TYPES[lesson.type].label}
          </span>{' '}
          {lesson.type !== 'check' && (lesson.type === 'try' || lesson.interactive) ? <YouTakePart /> : null}
        </td>
        <td data-label="Language and length">
          {LANGUAGES[lesson.language] ?? lesson.language} · {lengthWords(lesson)}
        </td>
        <td data-label="Status">
          <StatusChip status={lesson.status} placed={lesson.placement !== null} />
        </td>
        <td data-label="Last edited">{formatDate(lesson.updatedAt)}</td>
        <td>
          <div className="adm-cluster">
            <Link to={adminPaths.place(lesson.id)} className="adm-mini-btn" aria-label={`Edit: ${lesson.title}`}>
              <IconPencil size={20} />
              Edit
            </Link>
            {lesson.status === 'published' ? (
              <Link to={paths.lesson(lesson.id)} className="adm-mini-btn" aria-label={`Preview: ${lesson.title}`}>
                <IconEye size={20} />
                Preview
              </Link>
            ) : null}
            <button type="button" className="adm-mini-btn" aria-expanded={more} aria-label={`More actions: ${lesson.title}`} onClick={() => setMore((open) => !open)}>
              <IconMore size={20} />
              More
            </button>
          </div>
        </td>
      </tr>
      {more ? (
        <tr className="adm-lib__more">
          <td colSpan={8}>
            <div className="adm-cluster">
              {lesson.placement ? (
                <button type="button" className="adm-mini-btn" aria-busy={toggle.working || undefined} onClick={() => void toggle.run()}>
                  {lesson.status === 'published' ? <IconLock size={20} /> : <IconUpload size={20} />}
                  {toggle.working ? 'Working…' : lesson.status === 'published' ? 'Unpublish (back to draft)' : 'Publish to learners'}
                </button>
              ) : (
                <Link to={adminPaths.place(lesson.id)} className="adm-mini-btn">
                  <IconArrowRight size={20} />
                  Choose portal
                </Link>
              )}
              {lesson.type === 'watch' || lesson.type === 'check' ? (
                <Link to={adminPaths.questions(lesson.id)} className="adm-mini-btn">
                  <IconQuestion size={20} />
                  Questions
                </Link>
              ) : null}
              {lesson.type === 'try' ? (
                <Link to={adminPaths.tryIt(lesson.id)} className="adm-mini-btn">
                  <IconTryIt size={20} />
                  Try it setup
                </Link>
              ) : null}
              <ConfirmAction
                label="Delete"
                question={`Delete “${lesson.title}”? This cannot be undone.`}
                confirmLabel="Yes, delete it"
                working={remove.working}
                onConfirm={() => void remove.run()}
                icon={<IconTrash size={20} />}
              />
            </div>
            {error ? (
              <p className="adm-inline-error" role="alert">
                {error}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Waiting() {
  const waiting = useAdminApi((signal) => adminApi.getLibrary({ unplaced: true, pageSize: 1 }, { signal }), []);
  const first = waiting.data ? waiting.data.items[0] : undefined;
  if (!waiting.data || !first) return null;
  return (
    <div className="adm-card adm-row">
      <span className="adm-chip adm-chip--count">{waiting.data.total}</span>
      <p className="adm-row__grow adm-strong">{waiting.data.total === 1 ? '1 lesson is waiting to be placed' : `${waiting.data.total} lessons are waiting to be placed`}. Learners cannot see them yet.</p>
      <Link to={adminPaths.place(first.id)} className="adm-mini-btn">
        Place
        <span className="sb-visually-hidden"> the first waiting lesson</span>
      </Link>
    </div>
  );
}

export default function Library() {
  const { search: locationSearch } = useLocation();
  const params = new URLSearchParams(locationSearch);
  const portalId = asPortalId(params.get('portalId'));
  const groupId = (portalId && params.get('groupId')) || undefined;
  const seriesId = (groupId && params.get('seriesId')) || undefined;

  const [type, setType] = useState<LessonType | 'all'>('all');
  const [status, setStatus] = useState<PublishStatus | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const go = (query: LibraryLinkQuery) => {
    setPage(1);
    navigate(adminPaths.library(query), { replace: true, keepScroll: true });
  };

  const counts = useAdminApi((signal) => adminApi.getPortalCounts({ signal }), []);
  const portal = useAdminApi((signal) => (portalId ? learnerApi.getPortal(portalId, { signal }) : Promise.resolve(null)), [portalId]);
  const group = useAdminApi((signal) => (groupId ? learnerApi.getGroup(groupId, { signal }) : Promise.resolve(null)), [groupId]);
  const lessons = useAdminApi(
    (signal) =>
      adminApi.getLibrary({ portalId, groupId, seriesId, type: type === 'all' ? undefined : type, status: status === 'all' ? undefined : status, search: search || undefined, page, pageSize: PAGE_SIZE }, { signal }),
    [portalId, groupId, seriesId, type, status, search, page],
  );

  const portalData = portal.data && portal.data.id === portalId ? portal.data : null;
  const groupData = group.data && group.data.id === groupId ? group.data : null;
  const seriesData = groupData ? groupData.series.find((s) => s.id === seriesId) : undefined;
  const data = lessons.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchText.trim());
  };

  return (
    <AdminFrame title="Library" nav="library" wide>
      <div className="adm-lib__head">
        <PageHead title="Library" lead="Every lesson learners can open from this bag, by portal." />
        <ButtonLink to={adminPaths.add()} size="sm" icon={<IconPlus size={24} />}>
          Add lesson
        </ButtonLink>
      </div>

      <form className="adm-lib__search" role="search" onSubmit={submitSearch}>
        <InputField label="Search lessons" type="search" placeholder="Title, series or file name" maxLength={80} value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <Button type="submit" size="sm" variant="secondary" icon={<IconSearch size={24} />}>
          Search
        </Button>
      </form>

      <Waiting />

      <section aria-labelledby="adm-po-h" className="adm-stack">
        <h2 id="adm-po-h" className="adm-h2">
          Portals
        </h2>
        {counts.loading && !counts.data ? (
          <LoadingState label="Counting lessons…" />
        ) : counts.error && !counts.data ? (
          <ErrorState title="The portals did not load" error={counts.error} onRetry={counts.reload} />
        ) : (
          <div className="adm-lib__portals">
            <button type="button" className="adm-lib__portal" aria-pressed={!portalId} onClick={() => go({})}>
              <strong>All portals</strong>
              <span>{portalId ? 'Show' : 'Showing'}</span>
            </button>
            {(counts.data ?? []).map((entry) => (
              <button key={entry.portalId} type="button" className="adm-lib__portal" aria-pressed={portalId === entry.portalId} onClick={() => go({ portalId: entry.portalId })}>
                <strong>{entry.title}</strong>
                <span>
                  {entry.lessonCount === 1 ? '1 lesson' : `${entry.lessonCount} lessons`} · {portalId === entry.portalId ? 'Showing' : 'Show'}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="adm-ls-h" className="adm-card adm-stack">
        <div className="adm-lib__head">
          <div>
            <h2 id="adm-ls-h" className="adm-h2">
              {seriesData ? `Series: ${seriesData.title}` : groupData ? groupData.title : portalData ? portalData.title : 'All lessons'}
            </h2>
            {seriesData ? <p className="adm-small">Learners see them in this order.</p> : null}
          </div>
          {seriesId ? (
            <div className="adm-cluster">
              <Link to={adminPaths.series(seriesId)} className="adm-mini-btn">
                <IconSeriesOrder size={20} />
                Change order
              </Link>
            </div>
          ) : null}
        </div>

        <div className="adm-grid adm-grid--4">
          <SelectField label="Portal" value={portalId ?? ''} onChange={(event) => go(event.target.value ? { portalId: event.target.value } : {})}>
            <option value="">All portals</option>
            {(counts.data ?? []).map((entry) => (
              <option key={entry.portalId} value={entry.portalId}>
                {entry.title}
              </option>
            ))}
          </SelectField>
          <SelectField label="Audience, class or topic" value={groupId ?? ''} disabled={!portalData} onChange={(event) => go({ portalId, groupId: event.target.value || undefined })}>
            <option value="">{portalId ? 'All' : 'Choose a portal first'}</option>
            {(portalData ? portalData.groups : []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </SelectField>
          <SelectField label="Series" value={seriesId ?? ''} disabled={!groupData} onChange={(event) => go({ portalId, groupId, seriesId: event.target.value || undefined })}>
            <option value="">{groupId ? 'All series' : 'Choose a group first'}</option>
            {(groupData ? groupData.series : []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PublishStatus | 'all');
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </SelectField>
        </div>
        <div>
          <p className="adm-label" id="adm-type-l">
            Type
          </p>
          <div className="adm-groupbar" role="group" aria-labelledby="adm-type-l">
            {TYPES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => {
                  setType(value);
                  setPage(1);
                }}
              >
                {value === 'all' ? 'All' : LESSON_TYPES[value].label}
              </button>
            ))}
          </div>
        </div>

        {lessons.loading && !data ? (
          <LoadingState label="Loading lessons…" />
        ) : lessons.error && !data ? (
          <ErrorState title="The lessons did not load" error={lessons.error} onRetry={lessons.reload} />
        ) : data ? (
          <>
            {lessons.error ? <ErrorState title="The list could not be refreshed" error={lessons.error} onRetry={lessons.reload} /> : null}
            <p className="adm-note" role="status">
              <IconInfoMark size={20} />
              <span>
                Showing {data.items.length} of {data.total} · {data.publishedCount} published · {data.draftCount} draft{search ? ` · search: “${search}”` : ''}. Learners only see published lessons.
              </span>
            </p>
            {data.items.length === 0 ? (
              <EmptyState title="No lessons match">Change the filters or the search words, or add a lesson.</EmptyState>
            ) : (
              <table className="adm-table">
                <caption className="sb-visually-hidden">Lessons{seriesData ? ` in ${seriesData.title}` : ''}</caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Cover</th>
                    <th scope="col">Title</th>
                    <th scope="col">Type</th>
                    <th scope="col">Language and length</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last edited</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((lesson) => (
                    <LessonRow key={lesson.id} lesson={lesson} onChanged={lessons.reload} />
                  ))}
                </tbody>
              </table>
            )}
            {pages > 1 ? (
              <nav className="adm-row adm-row--between" aria-label="Pages of lessons">
                <button type="button" className="adm-mini-btn" disabled={page <= 1 || lessons.loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Previous
                </button>
                <span className="adm-strong">
                  Page {data.page} of {pages}
                </span>
                <button type="button" className="adm-mini-btn" disabled={page >= pages || lessons.loading} onClick={() => setPage((current) => current + 1)}>
                  Next
                </button>
              </nav>
            ) : null}
          </>
        ) : null}
        <p className="adm-small">Changes reach learners the next time they open the portal. Moving a lesson renumbers the ones after it.</p>
      </section>
    </AdminFrame>
  );
}
