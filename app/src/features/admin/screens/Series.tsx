/*
 * Series and order (ADM-Series): pick a series, put its lessons in the
 * order learners follow, save.
 *
 * Reordering uses plain "Move up" / "Move down" buttons: they work the same
 * by touch, mouse, keyboard and screen reader, on every browser down to the
 * floor, with no drag-and-drop code. The order is sent as one list; if the
 * series changed meanwhile the bag refuses it (409) and the newest order is
 * loaded instead of overwriting someone else's work.
 */
import { useRef, useState } from 'react';
import { adminApi, ApiError, learnerApi, type AdminLesson, type AdminSeries, type PortalId } from '@shared/api';
import { Button, ButtonLink, EmptyState, ErrorState, LESSON_TYPES, lessonActionLabel, LessonTypeIcon, LoadingState, Message, YouTakePart } from '@shared/components';
import { IconInfoMark, IconPlus, IconSave } from '@shared/icons';
import { Link, navigate, paths, useParams } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { PageHead, SelectField, StatusChip } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconEye, IconMoveDown, IconMoveUp, IconPhone, IconUndo } from '../icons';
import { useAction, useLeaveWarning } from '../lib/hooks';
import { moveItem, numberedLessons, sameOrder } from '../lib/placement';
import { useAdminApi } from '../session';
import './library.css';

function OrderEditor({ series, justSaved, onSaved, onReload }: { series: AdminSeries; justSaved: boolean; onSaved: () => void; onReload: () => void }) {
  // Copies: the answer from the bag is shared and is never reordered in place.
  const original = useRef(numberedLessons(series.lessons).map((lesson) => lesson.id)).current;
  const byId = useRef(new Map(series.lessons.map((lesson) => [lesson.id, lesson] as const))).current;
  const [order, setOrder] = useState<readonly string[]>(original);
  const [moved, setMoved] = useState<{ id: string; message: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const quiz = series.lessons.filter((lesson) => lesson.type === 'check');
  const changed = !sameOrder(order, original);
  useLeaveWarning(changed);

  const save = useAction(async () => {
    try {
      await adminApi.saveSeriesOrder(series.id, { lessonIds: order.slice() });
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        return;
      }
      throw error;
    }
  });

  const move = (index: number, delta: -1 | 1) => {
    const next = moveItem(order, index, delta);
    if (next === order) return;
    const id = order[index] as string;
    const lesson = byId.get(id);
    setOrder(next);
    setMoved({ id, message: `${lesson ? lesson.title : 'Lesson'} is now lesson ${index + delta + 1} of ${order.length}.` });
  };

  const lessons = order.map((id) => byId.get(id)).filter((lesson): lesson is AdminLesson => lesson !== undefined);

  if (conflict) {
    return (
      <Message
        tone="error"
        title="The series changed while you were working"
        action={
          <Button variant="danger" fullWidth onClick={onReload}>
            Load the newest order
          </Button>
        }
      >
        Someone added, removed or moved a lesson. Your order was not saved, so nothing was overwritten. Load the newest order and move the lessons again.
      </Message>
    );
  }

  return (
    <div className="adm-split">
      <section className="adm-card adm-stack" aria-labelledby="adm-ord-h">
        <h2 id="adm-ord-h" className="adm-h2">
          Lessons in order
        </h2>
        <p className="adm-note">
          <IconInfoMark size={20} />
          <span>Use Move up and Move down. Learners see this order. Changes show after you save.</span>
        </p>
        <p className="sb-visually-hidden" role="status">
          {moved ? moved.message : ''}
        </p>
        {lessons.length === 0 && quiz.length === 0 ? (
          <EmptyState title="No lessons in this series yet">Add a lesson and place it here.</EmptyState>
        ) : (
          <ol className="adm-order" aria-label="Lessons in this series, in order">
            {lessons.map((lesson, index) => (
              <li key={lesson.id} className={moved && moved.id === lesson.id ? 'adm-order--moved' : undefined}>
                <span className="adm-order__num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="adm-order__text">
                  <span className="adm-small">
                    <strong className="adm-strong">{LESSON_TYPES[lesson.type].label}</strong> · Lesson {index + 1}
                  </span>
                  <span className="adm-order__title">{lesson.title}</span>
                </span>
                <span className="adm-order__tools">
                  <StatusChip status={lesson.status} />
                  <button type="button" className="adm-mini-btn" disabled={index === 0 || save.working} aria-label={`Move up: ${lesson.title}`} onClick={() => move(index, -1)}>
                    <IconMoveUp size={22} />
                    Move up
                  </button>
                  <button type="button" className="adm-mini-btn" disabled={index === lessons.length - 1 || save.working} aria-label={`Move down: ${lesson.title}`} onClick={() => move(index, 1)}>
                    <IconMoveDown size={22} />
                    Move down
                  </button>
                </span>
              </li>
            ))}
            {quiz.map((lesson) => (
              <li key={lesson.id}>
                <span className="adm-order__num" aria-hidden="true">
                  <LessonTypeIcon type="check" size={24} />
                </span>
                <span className="adm-order__text">
                  <span className="adm-small">
                    <strong className="adm-strong">Check</strong> · Always last in the series
                  </span>
                  <span className="adm-order__title">{lesson.title}</span>
                </span>
                <span className="adm-order__tools">
                  <StatusChip status={lesson.status} />
                </span>
              </li>
            ))}
          </ol>
        )}
        <ButtonLink to={adminPaths.add()} variant="secondary" size="sm" icon={<IconPlus size={24} />}>
          Add lesson to this series
        </ButtonLink>
        <p className="adm-small">Draft lessons keep their place but learners do not see them.</p>
        {save.error ? (
          <Message tone="error" title="The order was not saved">
            {save.error}
          </Message>
        ) : null}
        {justSaved && !changed ? (
          <Message tone="success" title="Order saved">
            Learners see it the next time they open the series.
          </Message>
        ) : null}
        <div className="adm-cluster">
          <button type="button" className="adm-mini-btn" disabled={!changed || save.working} onClick={() => setOrder(original)}>
            <IconUndo size={22} />
            Undo changes
          </button>
          {changed ? (
            <Button size="sm" working={save.working} workingLabel="Saving the order…" icon={<IconSave size={24} />} onClick={() => void save.run()}>
              Save order
            </Button>
          ) : (
            <Button size="sm" notReady icon={<IconSave size={24} />}>
              Nothing to save
            </Button>
          )}
        </div>
      </section>

      <aside className="adm-split__aside adm-card adm-stack" aria-labelledby="adm-pv-h">
        <h2 id="adm-pv-h" className="adm-h2 adm-row">
          <IconPhone size={26} />
          <span>What learners see</span>
        </h2>
        <p className="adm-small">Their lesson list, in the order on the left. Drafts are left out.</p>
        <ol className="adm-list">
          {lessons
            .concat(quiz)
            .filter((lesson) => lesson.status === 'published')
            .map((lesson) => (
              <li key={lesson.id} className="adm-card" style={{ padding: 12 }}>
                <span className="adm-small">
                  <strong className="adm-strong">{LESSON_TYPES[lesson.type].label}</strong>
                  {lesson.type === 'check' ? '' : ` · Lesson ${order.indexOf(lesson.id) + 1}`}
                </span>{' '}
                {lesson.type !== 'check' && (lesson.type === 'try' || lesson.interactive) ? <YouTakePart /> : null}
                <span className="adm-order__title">{lesson.title}</span>
                <span className="adm-small">{lessonActionLabel(lesson)}</span>
              </li>
            ))}
        </ol>
        <Link to={paths.series(series.portalId, series.groupId, series.id)} className="adm-mini-btn">
          <IconEye size={22} />
          Open learner screen
        </Link>
      </aside>
    </div>
  );
}

export default function Series() {
  const params = useParams<'seriesId'>();
  const seriesId: string | undefined = params.seriesId || undefined;
  const series = useAdminApi((signal) => (seriesId ? adminApi.getAdminSeries(seriesId, { signal }) : Promise.resolve(null)), [seriesId]);
  const seriesData = series.data && series.data.id === seriesId ? series.data : null;

  // The pickers follow the open series; choosing a portal or group by hand overrides that until a series is opened.
  const [picked, setPicked] = useState<{ portalId: PortalId | ''; groupId: string }>({ portalId: '', groupId: '' });
  const portalId: PortalId | '' = picked.portalId || (seriesData ? seriesData.portalId : '');
  const groupId = picked.portalId ? picked.groupId : seriesData ? seriesData.groupId : '';

  const portals = useAdminApi((signal) => learnerApi.getPortals({ signal }), []);
  const portal = useAdminApi((signal) => (portalId ? learnerApi.getPortal(portalId, { signal }) : Promise.resolve(null)), [portalId]);
  const group = useAdminApi((signal) => (groupId ? learnerApi.getGroup(groupId, { signal }) : Promise.resolve(null)), [groupId]);
  const portalData = portal.data && portal.data.id === portalId ? portal.data : null;
  const groupData = group.data && group.data.id === groupId ? group.data : null;
  const pickerError = portals.error ?? portal.error ?? group.error;

  // A fresh editor after every load, so a saved or reloaded order starts clean.
  const [version, setVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(-1);
  const reload = (saved = false) => {
    setSavedVersion(saved ? version + 1 : -1);
    setVersion(version + 1);
    series.reload();
  };

  return (
    <AdminFrame title="Series and order" nav="series" wide>
      <PageHead title="Series and order" lead="Pick a series, then put its lessons in the order learners will follow." />

      <section className="adm-card adm-stack" aria-labelledby="adm-pick-h">
        <h2 id="adm-pick-h" className="adm-h2">
          Choose a series
        </h2>
        {pickerError ? <ErrorState title="The lists did not load" error={pickerError} onRetry={() => (portals.error ? portals.reload() : portal.error ? portal.reload() : group.reload())} /> : null}
        <div className="adm-grid adm-grid--4">
          <SelectField label="1 · Portal" value={portalId} onChange={(event) => setPicked({ portalId: event.target.value as PortalId | '', groupId: '' })}>
            <option value="">{portals.loading && !portals.data ? 'Loading…' : 'Choose a portal'}</option>
            {(portals.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </SelectField>
          <SelectField label="2 · Audience, class or topic" value={groupId} disabled={!portalData} onChange={(event) => portalId && setPicked({ portalId, groupId: event.target.value })}>
            <option value="">{portalId && !portalData ? 'Loading…' : 'Choose'}</option>
            {(portalData ? portalData.groups : []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="3 · Series"
            value={groupData && groupData.series.some((s) => s.id === seriesId) ? seriesId : ''}
            disabled={!groupData}
            onChange={(event) => {
              if (!event.target.value) return;
              setPicked({ portalId: '', groupId: '' });
              navigate(adminPaths.series(event.target.value), { keepScroll: true });
            }}
          >
            <option value="">{groupId && !groupData ? 'Loading…' : 'Choose a series'}</option>
            {(groupData ? groupData.series : []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </SelectField>
        </div>
      </section>

      {!seriesId ? (
        <EmptyState title="No series chosen yet">Choose a portal, then a group, then a series.</EmptyState>
      ) : series.error && !seriesData ? (
        <ErrorState title="This series did not open" error={series.error} onRetry={series.reload} />
      ) : !seriesData || (series.loading && version > 0) ? (
        <LoadingState label="Opening the series…" />
      ) : (
        <>
          <h2 className="adm-h2">{seriesData.title}</h2>
          <OrderEditor key={`${seriesData.id}-${version}`} series={seriesData} justSaved={savedVersion === version} onSaved={() => reload(true)} onReload={() => reload()} />
        </>
      )}
    </AdminFrame>
  );
}
