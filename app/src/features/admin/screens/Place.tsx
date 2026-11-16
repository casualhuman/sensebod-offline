/*
 * "Where does it go?" (ADM-M-Place on a phone; ADM-Add-3 "Details" with the
 * live card preview on a laptop).
 *
 * Portal → class / audience / topic → series → lesson number; the type was
 * set automatically and can be changed. The choices are held here; the rules
 * (what resets what, the position options, how the series will look) are the
 * pure functions in lib/placement.ts.
 */
import { useRef, useState, type ReactNode } from 'react';
import { adminApi, learnerApi, newRequestKey, type AdminLesson, type LessonSummary, type LessonType, type PortalId } from '@shared/api';
import { Button, ErrorState, formatLength, Illustration, LESSON_TYPES, lessonActionLabel, LessonTypeIcon, LoadingState, Message } from '@shared/components';
import { IconArrowRight, IconInfoMark, IconPencil, IconPlus, IconPortalAgriculture, IconPortalChildProtection, IconPortalClimate, IconPortalJss, IconPortalPrimary, IconSave, IconTick, IconUpload } from '@shared/icons';
import { Link, navigate, paths, useParams } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { InputField, LessonPreview, OptionRow, PageHead, SelectField, TextAreaField, TypeChip, TypeRule } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconEye, IconPicture } from '../icons';
import { TITLE_MAX, titleProblem } from '../lib/files';
import { flowSteps, forgetPublished, rememberPublished } from '../lib/flow';
import { useAction, useIsLaptop } from '../lib/hooks';
import {
  chooseGroup,
  choosePortal,
  chooseSeries,
  clampPosition,
  defaultPosition,
  fromPlacement,
  groupQuestion,
  placementProblem,
  positionCount,
  positionHint,
  previewSeries,
  seriesCountLabel,
  toPlacement,
  type PlacementChoice,
} from '../lib/placement';
import { useAdminApi } from '../session';
import './place.css';

const PORTAL_ICONS: Record<PortalId, (size: number) => ReactNode> = {
  primary: (size) => <IconPortalPrimary size={size} />,
  jss: (size) => <IconPortalJss size={size} />,
  'child-protection': (size) => <IconPortalChildProtection size={size} />,
  agriculture: (size) => <IconPortalAgriculture size={size} />,
  climate: (size) => <IconPortalClimate size={size} />,
};

const SOURCE_WORDS: Record<AdminLesson['source'], string> = {
  upload: 'From Upload files',
  'notes-photos': 'From photos of your notes',
  typed: 'Typed by you',
  animation: 'From Upload an animation',
  questions: 'Questions and quiz',
};

const SUMMARY_MAX = 160;
const TYPES: LessonType[] = ['watch', 'listen', 'read', 'try', 'check'];

function Step({ number, title, hint, children }: { number: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="adm-card">
      <fieldset className="adm-fieldset">
        <legend>
          <span className="adm-legend">
            <span className="adm-number" aria-hidden="true">
              {number}
            </span>
            <span>
              <span className="adm-h3" style={{ display: 'block' }}>
                {title}
              </span>
              <span className="adm-small">{hint}</span>
            </span>
          </span>
        </legend>
        {children}
      </fieldset>
    </section>
  );
}

function PlaceForm({ lesson }: { lesson: AdminLesson }) {
  const laptop = useIsLaptop();
  const [title, setTitle] = useState(lesson.title);
  const [summary, setSummary] = useState(lesson.summary);
  const [choice, setChoice] = useState<PlacementChoice>(() => fromPlacement(lesson.placement));
  const [type, setType] = useState<LessonType>(lesson.type);
  const [changingType, setChangingType] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [newSeries, setNewSeries] = useState<{ open: boolean; title: string; error: string | null }>({ open: false, title: '', error: null });
  const [saved, setSaved] = useState<'draft' | 'published' | null>(null);
  const seriesKey = useRef(newRequestKey());

  const portals = useAdminApi((signal) => learnerApi.getPortals({ signal }), []);
  const portalId = choice.portalId;
  const groupId = choice.groupId;
  const seriesId = choice.seriesId;
  const portal = useAdminApi((signal) => (portalId ? learnerApi.getPortal(portalId, { signal }) : Promise.resolve(null)), [portalId]);
  const group = useAdminApi((signal) => (groupId ? learnerApi.getGroup(groupId, { signal }) : Promise.resolve(null)), [groupId]);
  const series = useAdminApi((signal) => (seriesId ? adminApi.getAdminSeries(seriesId, { signal }) : Promise.resolve(null)), [seriesId]);

  // An answer only counts when it is the answer for what is chosen now.
  const portalData = portal.data && portal.data.id === portalId ? portal.data : null;
  const groupData = group.data && group.data.id === groupId ? group.data : null;
  const seriesData = series.data && series.data.id === seriesId ? series.data : null;

  const count = seriesData ? positionCount(seriesData.lessons, lesson.id) : 0;
  const position = seriesData ? clampPosition(choice.position ?? defaultPosition(seriesData.lessons, lesson.id), count) : null;
  const complete: PlacementChoice = { ...choice, position };
  const missing = placementProblem(complete);
  const question = groupQuestion(portalData ? portalData.groupKind : null);

  const patch = async () => {
    const placement = toPlacement(complete);
    return adminApi.updateLesson(lesson.id, {
      title: title.trim(),
      ...(laptop ? { summary: summary.trim() } : {}),
      ...(placement ? { placement } : {}),
      ...(type !== lesson.type ? { type } : {}),
    });
  };
  const valid = (needPlacement: boolean): boolean => {
    const problem = titleProblem(title);
    setTitleError(problem);
    setShowMissing(needPlacement && missing !== null);
    return !problem && !(needPlacement && missing);
  };

  const next = useAction(async () => {
    await patch();
    navigate(adminPaths.check(lesson.id));
  });
  const toPicture = useAction(async () => {
    // Keep what was typed and chosen so far before leaving for the gallery.
    if (!titleProblem(title)) await patch();
    navigate(adminPaths.picture(lesson.id, 'place'));
  });
  const saveDraft = useAction(async () => {
    const updated = await patch();
    if (updated.status === 'published') {
      await adminApi.unpublishLesson(lesson.id);
      forgetPublished(lesson.id);
    }
    setSaved('draft');
  });
  const publish = useAction(async () => {
    await patch();
    await adminApi.publishLesson(lesson.id);
    rememberPublished(lesson.id);
    setSaved('published');
  });
  const createSeries = useAction(async () => {
    if (!portalId || !groupId) return;
    const made = await adminApi.createSeries({ portalId, groupId, title: newSeries.title.trim() }, { idempotencyKey: seriesKey.current });
    seriesKey.current = newRequestKey();
    setNewSeries({ open: false, title: '', error: null });
    group.reload();
    setChoice((current) => chooseSeries(current, made.id));
  });
  const busy = next.working || saveDraft.working || publish.working || toPicture.working;

  const pick = (update: (current: PlacementChoice) => PlacementChoice) => {
    setChoice(update);
    setShowMissing(false);
    setSaved(null);
  };

  const preview: LessonSummary = { ...lesson, title: title.trim(), summary: laptop ? summary.trim() : lesson.summary, type, position, interactive: type === 'try' ? true : lesson.interactive };
  const rows = seriesData && position ? previewSeries(seriesData.lessons, { id: lesson.id, type, title: title.trim() || lesson.title }, position) : [];

  /* ---- the pieces, shared by the two layouts ---- */

  const titleField = (
    <InputField
      label={laptop ? 'Title' : 'Title learners will see'}
      hint={laptop ? 'Short and clear. Learners see it in big letters on the card.' : undefined}
      value={title}
      maxLength={TITLE_MAX}
      error={titleError}
      onChange={(event) => {
        setTitle(event.target.value);
        setTitleError(null);
        setSaved(null);
      }}
    />
  );

  const pictureRow = (
    <div className="adm-stack--sm">
      <p className="adm-label">Picture</p>
      <div className="adm-place__picture">
        <span className="adm-thumb">{lesson.picture ? <Illustration src={lesson.picture.url} alt="" /> : null}</span>
        <span className="adm-row__grow">
          <span className="adm-strong" style={{ display: 'block' }}>
            {lesson.picture ? lesson.picture.alt || 'Picture chosen' : 'No picture yet'}
          </span>
          <span className="adm-small">Learners see it on the lesson card.</span>
        </span>
      </div>
      <Button variant="secondary" size="sm" fullWidth icon={<IconPicture size={24} />} working={toPicture.working} workingLabel="Opening the gallery…" onClick={() => void toPicture.run()}>
        {lesson.picture ? 'Change picture' : 'Choose a picture'}
      </Button>
      {toPicture.error ? (
        <p className="adm-inline-error" role="alert">
          {toPicture.error}
        </p>
      ) : null}
    </div>
  );

  const portalChooser = portals.loading && !portals.data ? (
    <LoadingState label="Loading the portals…" />
  ) : portals.error && !portals.data ? (
    <ErrorState title="The portals did not load" error={portals.error} onRetry={portals.reload} />
  ) : laptop ? (
    <SelectField label="Portal" hint="1 · Which portal" value={portalId ?? ''} error={showMissing && !portalId ? 'Choose a portal.' : null} onChange={(event) => event.target.value && pick((c) => choosePortal(c, event.target.value as PortalId))}>
      <option value="">Choose a portal</option>
      {(portals.data ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </SelectField>
  ) : (
    (portals.data ?? []).map((p) => (
      <OptionRow key={p.id} name="adm-portal" value={p.id} checked={portalId === p.id} onChoose={() => pick((c) => choosePortal(c, p.id))} label={p.title} detail={p.description} icon={PORTAL_ICONS[p.id](26)} />
    ))
  );

  const groupChooser = !portalId ? null : portal.loading && !portalData ? (
    <LoadingState />
  ) : portal.error && !portalData ? (
    <ErrorState title="The list did not load" error={portal.error} onRetry={portal.reload} />
  ) : !portalData ? null : laptop ? (
    <SelectField
      label="Class, audience or topic"
      hint="2 · Changes with the portal: a class for Primary and JSS, an audience for Child protection, a topic for Agriculture and Climate."
      value={groupId ?? ''}
      error={showMissing && !groupId ? `Choose a ${question.noun}.` : null}
      onChange={(event) => event.target.value && pick((c) => chooseGroup(c, event.target.value))}
    >
      <option value="">Choose a {question.noun}</option>
      {portalData.groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.title}
        </option>
      ))}
    </SelectField>
  ) : (
    portalData.groups.map((g) => <OptionRow key={g.id} name="adm-group" value={g.id} checked={groupId === g.id} onChoose={() => pick((c) => chooseGroup(c, g.id))} label={g.title} detail={g.availability === 'not-in-bag' ? 'No lessons in this bag yet' : undefined} />)
  );

  const newSeriesForm = (
    <div className="adm-stack" style={{ marginTop: 10 }}>
      {newSeries.open ? (
        <div className="adm-card adm-stack">
          <InputField label="Name of the new series" value={newSeries.title} maxLength={TITLE_MAX} error={newSeries.error ?? createSeries.error} onChange={(event) => setNewSeries({ open: true, title: event.target.value, error: null })} />
          <div className="adm-cluster">
            <Button
              size="sm"
              working={createSeries.working}
              workingLabel="Making the series…"
              onClick={() => {
                const problem = titleProblem(newSeries.title, 'a name');
                if (problem) setNewSeries({ ...newSeries, error: problem });
                else void createSeries.run();
              }}
            >
              Add this series
            </Button>
            <button type="button" className="adm-mini-btn" onClick={() => setNewSeries({ open: false, title: '', error: null })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="adm-mini-btn" onClick={() => setNewSeries({ open: true, title: '', error: null })}>
          <IconPlus size={22} />
          Start a new series
        </button>
      )}
    </div>
  );

  const seriesChooser = !groupId ? null : group.loading && !groupData ? (
    <LoadingState />
  ) : group.error && !groupData ? (
    <ErrorState title="The series did not load" error={group.error} onRetry={group.reload} />
  ) : !groupData ? null : (
    <>
      {laptop ? (
        <SelectField label="Series" hint="3 · The series learners open." value={seriesId ?? ''} error={showMissing && !seriesId ? 'Choose a series.' : null} onChange={(event) => event.target.value && pick((c) => chooseSeries(c, event.target.value))}>
          <option value="">Choose a series</option>
          {groupData.series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {seriesCountLabel(s.lessonCount, s.hasQuiz)}
            </option>
          ))}
        </SelectField>
      ) : groupData.series.length === 0 ? (
        <p className="adm-small">There is no series here yet. Start one below.</p>
      ) : (
        groupData.series.map((s) => <OptionRow key={s.id} name="adm-series" value={s.id} checked={seriesId === s.id} onChoose={() => pick((c) => chooseSeries(c, s.id))} label={s.title} detail={seriesCountLabel(s.lessonCount, s.hasQuiz)} />)
      )}
      {newSeriesForm}
    </>
  );

  const positionChooser = !seriesId ? null : series.loading && !seriesData ? (
    <LoadingState />
  ) : series.error && !seriesData ? (
    <ErrorState title="The lessons did not load" error={series.error} onRetry={series.reload} />
  ) : !seriesData || !position ? null : type === 'check' ? (
    <p className="adm-note">
      <IconInfoMark size={20} />
      <span>A quiz is always last in its series.</span>
    </p>
  ) : (
    <>
      <SelectField label="Lesson number" value={String(position)} onChange={(event) => pick((c) => ({ ...c, position: Number(event.target.value) }))} hint={`${positionHint(position)}. Lessons after it move down one.`}>
        {Array.from({ length: count }, (_, index) => (
          <option key={index + 1} value={index + 1}>
            Lesson {index + 1}
          </option>
        ))}
      </SelectField>
      <div className="adm-place__preview">
        <p className="adm-label">How the series will look</p>
        <ol className="adm-list">
          {rows.map((row) => (
            <li key={row.id} className={row.isNew ? 'adm-place__row adm-place__row--new' : 'adm-place__row'}>
              <span className="adm-place__num">{row.number ?? ''}</span>
              <LessonTypeIcon type={row.type} size={22} />
              <span className="adm-row__grow">
                <strong>{LESSON_TYPES[row.type].label}</strong> · {row.title}
              </span>
              {row.isNew ? <span className="adm-chip adm-chip--new">{lesson.placement ? 'This one' : 'New'}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </>
  );

  const typeChooser = (
    <div className="adm-stack--sm">
      <div className="adm-row">
        <span className={type === 'listen' ? 'adm-disc adm-disc--listen' : 'adm-disc'} aria-hidden="true">
          <LessonTypeIcon type={type} size={26} />
        </span>
        <span className="adm-row__grow">
          <span className="adm-card__title">{LESSON_TYPES[type].label}</span>
          <span className="adm-small">Learners tap “{lessonActionLabel({ type, interactive: lesson.interactive })}”.</span>
        </span>
        <button type="button" className="adm-link-btn" aria-expanded={changingType} onClick={() => setChangingType((open) => !open)}>
          <IconPencil size={20} />
          Change
        </button>
      </div>
      {changingType ? (
        <SelectField label="Lesson type" hint="Only change it if the type set for you is wrong." value={type} onChange={(event) => setType(event.target.value as LessonType)}>
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {LESSON_TYPES[value].label}
              {value === lesson.type ? ' (set for you)' : ''}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TypeRule />
    </div>
  );

  const errors = (
    <>
      {showMissing && missing ? (
        <Message tone="error" title={missing}>
          Learners can only find a lesson that has a place.
        </Message>
      ) : null}
      {next.error || saveDraft.error || publish.error ? (
        <Message tone="error" title="Not saved">
          {next.error ?? saveDraft.error ?? publish.error}
        </Message>
      ) : null}
    </>
  );

  if (laptop) {
    return (
      <AdminFrame
        title="Details"
        nav={lesson.placement ? 'library' : 'add'}
        wide
        back={{ to: lesson.placement ? adminPaths.library() : adminPaths.add(), label: lesson.placement ? 'Back to Library' : 'Back' }}
        steps={lesson.placement ? undefined : flowSteps('place', true)}
      >
        <PageHead title={lesson.placement ? 'Edit lesson' : 'Add lesson'} lead={`${LESSON_TYPES[type].label} lesson${lesson.fileNames[0] ? `: ${lesson.fileNames.join(', ')}` : ''}`} />
        <div className="adm-split">
          <div className="adm-card adm-stack--lg">
            <div>
              <h2 className="adm-h2">Details</h2>
              <p className="adm-small">The preview on the right changes as you type.</p>
            </div>
            {titleField}
            <TextAreaField label="What you will learn" hint="One sentence. Shown under the title." rows={2} maxLength={SUMMARY_MAX} value={summary} onChange={(event) => setSummary(event.target.value)} />
            <fieldset className="adm-fieldset adm-stack">
              <legend className="adm-h3">Where learners find it</legend>
              {portalChooser}
              {groupChooser}
              {seriesChooser}
            </fieldset>
            {positionChooser}
            {pictureRow}
            {typeChooser}
          </div>
          <aside className="adm-split__aside adm-card adm-stack" aria-labelledby="adm-s4-h">
            <h2 id="adm-s4-h" className="adm-h2">
              Check and publish
            </h2>
            <p className="adm-small">This is the card learners will see on a phone.</p>
            <LessonPreview lesson={preview} seriesTitle={seriesData ? seriesData.title : null} />
            {lesson.notes.map((note) => (
              <p key={note} className="adm-note">
                <IconInfoMark size={20} />
                <span>{note}</span>
              </p>
            ))}
            {errors}
            {saved === 'published' ? (
              <Message tone="success" title="Published!">
                Learners see it the next time they open the portal.{' '}
                {complete.portalId && complete.groupId && complete.seriesId ? <Link to={paths.series(complete.portalId, complete.groupId, complete.seriesId)}>See it as a learner</Link> : null}
              </Message>
            ) : saved === 'draft' ? (
              <Message tone="success" title="Saved as a draft">
                Only admins can see it.
              </Message>
            ) : null}
            <Button variant="secondary" fullWidth disabled={busy && !saveDraft.working} working={saveDraft.working} workingLabel="Saving…" icon={<IconSave size={26} />} onClick={() => valid(false) && void saveDraft.run()}>
              Save as draft
            </Button>
            <Button fullWidth disabled={busy && !publish.working} working={publish.working} workingLabel="Publishing…" icon={<IconUpload size={26} />} onClick={() => valid(true) && void publish.run()}>
              Publish to learners
            </Button>
            <p className="adm-note">
              <IconEye size={20} />
              <span>Learners see it the next time they open the portal.</span>
            </p>
          </aside>
        </div>
      </AdminFrame>
    );
  }

  return (
    <AdminFrame
      title="Where does it go?"
      nav={lesson.placement ? 'library' : 'add'}
      back={{ to: lesson.placement ? adminPaths.library() : adminPaths.home() }}
      steps={flowSteps('place', false)}
      action={
        missing && !showMissing ? (
          <Button fullWidth variant="secondary" icon={<IconPencil size={26} />} onClick={() => valid(true)}>
            {missing}
          </Button>
        ) : (
          <Button fullWidth working={next.working} workingLabel="Saving on the bag…" iconAfter={<IconArrowRight size={26} />} onClick={() => valid(true) && void next.run()}>
            Next: check and publish
          </Button>
        )
      }
    >
      <PageHead title="Where does it go?" lead="Choose where learners will find it. One question at a time." />

      <section aria-label="What you are adding" className="adm-card adm-stack">
        <div className="adm-row">
          <span className="adm-disc adm-disc--lg" aria-hidden="true">
            <LessonTypeIcon type={lesson.type} size={30} />
          </span>
          <div className="adm-row__grow">
            <p className="adm-card__title">{lesson.title}</p>
            {lesson.fileNames.length > 0 || lesson.length !== null ? (
              <p className="adm-small" style={{ wordBreak: 'break-all' }}>
                {lesson.fileNames.join(', ')}
                {lesson.length !== null ? ` · ${formatLength(lesson.length)}` : ''}
              </p>
            ) : null}
            <p className="adm-small adm-strong">{SOURCE_WORDS[lesson.source]}</p>
          </div>
        </div>
        {titleField}
        {pictureRow}
      </section>

      <Step number={1} title="Portal" hint="Which part of Sensebod Offline?">
        {portalChooser}
      </Step>
      {portalId ? (
        <Step number={2} title={question.title} hint={question.hint}>
          {groupChooser}
        </Step>
      ) : null}
      {groupId ? (
        <Step number={3} title="Series" hint="Lessons that belong together.">
          {seriesChooser}
        </Step>
      ) : null}
      {seriesId ? (
        <section className="adm-card adm-stack">
          <div className="adm-legend">
            <span className="adm-number" aria-hidden="true">
              4
            </span>
            <div>
              <h2 className="adm-h3">Position</h2>
              <p className="adm-small">Where it sits in {seriesData ? seriesData.title : 'the series'}.</p>
            </div>
          </div>
          {positionChooser}
        </section>
      ) : null}
      <section className="adm-card adm-stack">
        <div className="adm-legend">
          <span className="adm-number" aria-hidden="true">
            5
          </span>
          <div>
            <h2 className="adm-h3">Type</h2>
            <p className="adm-small">
              Set for you from what you added: <TypeChip type={lesson.type} />
            </p>
          </div>
        </div>
        {typeChooser}
      </section>
      {errors}
      {!missing ? (
        <p className="adm-note adm-note--ok">
          <IconTick size={20} />
          <span>Ready. Tap Next to check it and publish.</span>
        </p>
      ) : null}
    </AdminFrame>
  );
}

export default function Place() {
  const { lessonId } = useParams<'lessonId'>();
  const lesson = useAdminApi((signal) => adminApi.getAdminLesson(lessonId, { signal }), [lessonId]);
  // Only the answer for this URL's lesson is shown; the form is rebuilt when the lesson changes.
  const data = lesson.data && lesson.data.id === lessonId ? lesson.data : null;
  if (!data) {
    return (
      <AdminFrame title="Where does it go?" nav="add" back={{ to: adminPaths.home() }}>
        {lesson.error ? <ErrorState title="This lesson did not open" error={lesson.error} onRetry={lesson.reload} /> : <LoadingState label="Opening the lesson…" />}
      </AdminFrame>
    );
  }
  return <PlaceForm key={data.id} lesson={data} />;
}
