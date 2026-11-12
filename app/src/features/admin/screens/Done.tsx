/*
 * Check and publish (ADM-M-Done): the card exactly as learners will see it,
 * what is ready and what is missing, then Publish or Save as draft.
 */
import { useState } from 'react';
import { adminApi, type AdminLesson } from '@shared/api';
import { Button, ButtonLink, ErrorState, LESSON_TYPES, LoadingState, Message } from '@shared/components';
import { IconArrowRight, IconInfoMark, IconPlus, IconSave, IconTick, IconUpload } from '@shared/icons';
import { paths, useParams } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { LessonPreview, PageHead, TextAreaField } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconEye, IconPicture } from '../icons';
import { flowSteps, forgetPublished, rememberPublished } from '../lib/flow';
import { useAction, useIsLaptop } from '../lib/hooks';
import { useAdminApi } from '../session';

const TRANSCRIPT_MAX = 20000;

function ReadAlong({ lesson, onSaved }: { lesson: AdminLesson; onSaved: (lesson: AdminLesson) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(async () => {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onSaved(await adminApi.updateLesson(lesson.id, { transcript: lines.map((line) => ({ start: null, text: line })) }));
    setOpen(false);
  });
  if (!open) {
    return (
      <button type="button" className="adm-link-btn" onClick={() => setOpen(true)}>
        <IconPlus size={20} />
        Add read along
      </button>
    );
  }
  return (
    <div className="adm-stack">
      <TextAreaField
        label="Read-along text"
        hint="Type or paste the words of the story or talk. Learners can read them while they listen."
        rows={5}
        maxLength={TRANSCRIPT_MAX}
        value={text}
        error={problem ?? save.error}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
      />
      <div className="adm-cluster">
        <Button
          size="sm"
          working={save.working}
          workingLabel="Saving the words…"
          onClick={() => {
            if (!text.trim()) setProblem('Type the words first.');
            else void save.run();
          }}
        >
          Save the words
        </Button>
        <button type="button" className="adm-mini-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DoneForm({ initial }: { initial: AdminLesson }) {
  const laptop = useIsLaptop();
  const [lesson, setLesson] = useState(initial);
  const [result, setResult] = useState<'published' | 'draft' | null>(null);

  const publish = useAction(async () => {
    setLesson(await adminApi.publishLesson(lesson.id));
    rememberPublished(lesson.id);
    setResult('published');
  });
  const keepDraft = useAction(async () => {
    if (lesson.status === 'published') {
      setLesson(await adminApi.unpublishLesson(lesson.id));
      forgetPublished(lesson.id);
    }
    setResult('draft');
  });

  const placement = lesson.placement;
  const where = lesson.placementLabel ? `${lesson.placementLabel}${lesson.position ? `, Lesson ${lesson.position}` : ''}` : null;
  const seriesTitle = lesson.placementLabel ? (lesson.placementLabel.split(' → ').pop() ?? null) : null;
  const busy = publish.working || keepDraft.working;

  return (
    <AdminFrame title="Check and publish" nav={result ? 'home' : 'add'} back={{ to: adminPaths.place(lesson.id) }} steps={flowSteps('check', laptop)}>
      <PageHead title="Check and publish" lead="This is exactly what learners will see on their phones." />
      <LessonPreview lesson={lesson} seriesTitle={seriesTitle} />

      {result === 'published' ? (
        <section className="adm-stack" aria-labelledby="adm-ok-h">
          <Message tone="success" title="Published!">
            <span id="adm-ok-h">Learners {where ? `in ${lesson.placementLabel?.split(' → ').slice(0, 2).join(' → ')} ` : ''}will see it next time they open it.</span>
          </Message>
          <ButtonLink to={adminPaths.home()} fullWidth icon={<IconPlus size={26} />}>
            Add more content
          </ButtonLink>
          {placement ? (
            <ButtonLink to={paths.series(placement.portalId, placement.groupId, placement.seriesId)} variant="secondary" fullWidth icon={<IconEye size={26} />}>
              See it as a learner
            </ButtonLink>
          ) : null}
        </section>
      ) : result === 'draft' ? (
        <section className="adm-stack">
          <Message tone="success" title="Saved as a draft">
            Only admins can see it. You can publish it later from the Library.
          </Message>
          <ButtonLink to={adminPaths.home()} fullWidth icon={<IconPlus size={26} />}>
            Add more content
          </ButtonLink>
          <ButtonLink to={adminPaths.library(placement ? { portalId: placement.portalId, groupId: placement.groupId, seriesId: placement.seriesId } : {})} variant="secondary" fullWidth>
            Open the Library
          </ButtonLink>
        </section>
      ) : (
        <>
          <section className="adm-card adm-stack" aria-labelledby="adm-chk-h">
            <h2 id="adm-chk-h" className="adm-h2">
              {placement ? 'Ready to publish' : 'Not ready yet'}
            </h2>
            <ul className="adm-list">
              <li className="adm-note adm-note--ok">
                <IconTick size={20} />
                <span>
                  <strong>Title</strong> · {lesson.title}
                </span>
              </li>
              <li className={placement ? 'adm-note adm-note--ok' : 'adm-note adm-note--warn'}>
                {placement ? <IconTick size={20} /> : <IconInfoMark size={20} />}
                <span>
                  <strong>Portal</strong> · {where ?? 'Not on a portal yet. Choose where it goes first.'}
                </span>
              </li>
              <li className="adm-note adm-note--ok">
                <IconTick size={20} />
                <span>
                  <strong>Type</strong> · {LESSON_TYPES[lesson.type].label}, set from what you added
                </span>
              </li>
              <li className={lesson.picture ? 'adm-note adm-note--ok' : 'adm-note'}>
                {lesson.picture ? <IconTick size={20} /> : <IconPicture size={20} />}
                <span>
                  <strong>Picture</strong> · {lesson.picture ? lesson.picture.alt || 'Chosen' : 'No picture yet. The card shows a plain colour.'}
                </span>
              </li>
              {lesson.notes.map((note) => (
                <li key={note} className="adm-note adm-note--warn">
                  <IconInfoMark size={20} />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
            <div className="adm-cluster">
              <ButtonLink to={adminPaths.picture(lesson.id, 'check')} variant="secondary" size="sm" icon={<IconPicture size={24} />}>
                {lesson.picture ? 'Change picture' : 'Choose a picture'}
              </ButtonLink>
            </div>
            {lesson.type === 'listen' && lesson.notes.some((note) => note.indexOf('Read along') === 0) ? <ReadAlong lesson={lesson} onSaved={setLesson} /> : null}
          </section>

          {publish.error || keepDraft.error ? (
            <Message tone="error" title="That did not work">
              {publish.error ?? keepDraft.error}
            </Message>
          ) : null}

          {placement ? (
            <div className="adm-stack">
              <Button size="lg" fullWidth disabled={busy && !publish.working} working={publish.working} workingLabel="Publishing…" icon={<IconUpload size={28} />} onClick={() => void publish.run()}>
                Publish to learners
              </Button>
              <Button variant="secondary" fullWidth disabled={busy && !keepDraft.working} working={keepDraft.working} workingLabel="Saving…" icon={<IconSave size={26} />} onClick={() => void keepDraft.run()}>
                Save as draft
              </Button>
              <p className="adm-small">A draft is only seen by admins.</p>
            </div>
          ) : (
            <ButtonLink to={adminPaths.place(lesson.id)} fullWidth iconAfter={<IconArrowRight size={26} />}>
              Choose where it goes
            </ButtonLink>
          )}
        </>
      )}
    </AdminFrame>
  );
}

export default function Done() {
  const { lessonId } = useParams<'lessonId'>();
  const lesson = useAdminApi((signal) => adminApi.getAdminLesson(lessonId, { signal }), [lessonId]);
  const data = lesson.data && lesson.data.id === lessonId ? lesson.data : null;
  if (!data) {
    return (
      <AdminFrame title="Check and publish" nav="add" back={{ to: adminPaths.home() }}>
        {lesson.error ? <ErrorState title="This lesson did not open" error={lesson.error} onRetry={lesson.reload} /> : <LoadingState label="Opening the lesson…" />}
      </AdminFrame>
    );
  }
  return <DoneForm key={data.id} initial={data} />;
}
