/*
 * Type it yourself (ADM-M-Type): a title, the lesson as plain blocks
 * (paragraph, heading, list, picture) and an optional recording of the
 * facilitator reading it.
 *
 * The words are copied to this phone as they are typed (lib/typedLesson.ts)
 * and sent to the bag when "Next" is tapped. Text is always rendered by
 * React as text: nothing typed here is ever treated as HTML.
 */
import { useEffect, useRef, useState } from 'react';
import { adminApi, describeError, isAbort, type LessonSummary, type UploadHandle, type Upload } from '@shared/api';
import { Button, Illustration, Message } from '@shared/components';
import { IconArrowRight, IconClose, IconInfoMark, IconMicrophone, IconPencil, IconPlus, IconRead, IconTick, IconTrash } from '@shared/icons';
import { navigate } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { ConfirmAction, FilePicker, InputField, LessonPreview, PageHead, ProgressBar, TypeRule } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconMoveDown, IconMoveUp, IconPicture, IconSaved } from '../icons';
import { ACCEPT, ACCEPT_ATTR, classifyFileName, percent, TITLE_MAX } from '../lib/files';
import { flowSteps } from '../lib/flow';
import { useAction, useIsLaptop } from '../lib/hooks';
import { moveItem } from '../lib/placement';
import { clearTypedDraft, countWords, emptyDraft, hasContent, loadTypedDraft, newBlockId, saveTypedDraft, toReadBlocks, typedProblem, type EditorBlock, type TypedDraft } from '../lib/typedLesson';
import { noteAdminError } from '../session';
import './type.css';

const BLOCK_LABELS = { paragraph: 'Paragraph', heading: 'Heading', list: 'List', picture: 'Picture' } as const;
const BLOCK_MAX = 5000;
const ALT_MAX = 200;

type Voice = { state: 'none' } | { state: 'sending'; name: string; sent: number; total: number } | { state: 'failed'; message: string };

export default function TypeLesson() {
  const laptop = useIsLaptop();
  const [draft, setDraft] = useState<TypedDraft>(() => loadTypedDraft() ?? emptyDraft());
  const [restored] = useState(() => hasContent(draft));
  const [kept, setKept] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<{ field: 'title' | 'blocks'; message: string } | null>(null);
  const [voice, setVoice] = useState<Voice>({ state: 'none' });
  const voiceHandle = useRef<UploadHandle<Upload> | null>(null);
  const [pendingPicture, setPendingPicture] = useState<{ file: File; alt: string; error: string | null } | null>(null);
  const finished = useRef(false);

  // Copy to this phone shortly after each change, and at once when the screen goes away.
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (finished.current) return undefined;
    const timer = setTimeout(() => setKept(hasContent(draft) ? saveTypedDraft(draft) : null), 400);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(
    () => () => {
      if (!finished.current && hasContent(latest.current)) saveTypedDraft(latest.current);
      if (voiceHandle.current) voiceHandle.current.abort();
    },
    [],
  );

  const change = (update: (current: TypedDraft) => TypedDraft) => {
    setDraft(update);
    setProblem(null);
  };
  const setBlocks = (update: (blocks: EditorBlock[]) => EditorBlock[]) => change((current) => ({ ...current, blocks: update(current.blocks) }));
  const patchBlock = (id: string, patch: Partial<EditorBlock>) => setBlocks((blocks) => blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as EditorBlock) : block)));
  const addBlock = (kind: 'paragraph' | 'heading' | 'list') =>
    setBlocks((blocks) => blocks.concat(kind === 'list' ? { id: newBlockId(), kind, text: '', ordered: false } : { id: newBlockId(), kind, text: '' }));

  const save = useAction(async () => {
    const lesson = await adminApi.createLesson(
      { source: 'typed', title: draft.title.trim(), blocks: toReadBlocks(draft.blocks), readAlongUploadId: draft.voice ? draft.voice.uploadId : undefined },
      { idempotencyKey: draft.requestKey },
    );
    finished.current = true;
    clearTypedDraft();
    navigate(adminPaths.place(lesson.id));
  });

  const next = () => {
    const found = typedProblem(draft);
    setProblem(found);
    if (!found) void save.run();
  };

  const addPicture = useAction(async () => {
    if (!pendingPicture) return;
    const alt = pendingPicture.alt.trim();
    const picture = await adminApi.uploadPicture(pendingPicture.file, alt).promise;
    setBlocks((blocks) => blocks.concat({ id: newBlockId(), kind: 'picture', picture: { url: picture.url, alt: picture.alt }, caption: '' }));
    setPendingPicture(null);
  });

  const recordChosen = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (ACCEPT.audio.indexOf(classifyFileName(file.name).kind) === -1 || file.size === 0) {
      setVoice({ state: 'failed', message: 'That is not a sound recording this bag can use. Record again, or choose an audio file.' });
      return;
    }
    if (voiceHandle.current) voiceHandle.current.abort();
    setVoice({ state: 'sending', name: file.name, sent: 0, total: file.size });
    const handle = adminApi.uploadContent(file, {}, (sent, total) => setVoice({ state: 'sending', name: file.name, sent, total }));
    voiceHandle.current = handle;
    handle.promise.then(
      (upload) => {
        voiceHandle.current = null;
        setVoice({ state: 'none' });
        change((current) => ({ ...current, voice: { uploadId: upload.id, fileName: upload.fileName } }));
      },
      (error: unknown) => {
        voiceHandle.current = null;
        if (isAbort(error)) setVoice({ state: 'none' });
        else if (!noteAdminError(error)) setVoice({ state: 'failed', message: describeError(error) });
      },
    );
  };

  const removeVoice = () => {
    const current = draft.voice;
    change((value) => ({ ...value, voice: null }));
    // Best effort: an unused recording left on the bag does no harm.
    if (current) adminApi.deleteUpload(current.uploadId).catch(() => undefined);
  };

  const startAgain = () => {
    clearTypedDraft();
    setDraft(emptyDraft());
    setProblem(null);
    setKept(null);
  };

  const words = countWords(draft.blocks);
  const preview: LessonSummary = {
    id: 'preview',
    seriesId: '',
    position: null,
    title: draft.title.trim(),
    summary: '',
    picture: null,
    language: 'en',
    type: 'read',
    interactive: false,
    captions: false,
    readAlong: draft.voice !== null,
    needsSound: false,
    length: null,
    pages: null,
  };

  return (
    <AdminFrame
      title="Type it yourself"
      nav="add"
      back={{ to: laptop ? adminPaths.add() : adminPaths.home() }}
      steps={flowSteps('add', laptop)}
      action={
        <Button fullWidth working={save.working} workingLabel="Saving on the bag…" iconAfter={<IconArrowRight size={26} />} onClick={next}>
          Next: choose where it goes
        </Button>
      }
    >
      <PageHead eyebrow="Type it yourself" title="Write your lesson" />

      {restored ? (
        <Message tone="info" title="Your words are still here">
          This is what you typed before. Carry on, or start again below.
        </Message>
      ) : null}

      <section className="adm-card adm-stack--sm" aria-label="Lesson type">
        <p className="adm-label">Lesson type</p>
        <p className="adm-row adm-strong">
          <span className="adm-disc adm-disc--sm" aria-hidden="true">
            <IconRead size={18} />
          </span>
          <span>Read</span>
        </p>
        <p className="adm-small">Set for you: typed text becomes a Read lesson. Learners tap “Read”. You can change it on the next step.</p>
        <TypeRule />
      </section>

      <InputField
        label="Title"
        value={draft.title}
        maxLength={TITLE_MAX}
        error={problem && problem.field === 'title' ? problem.message : null}
        onChange={(event) => change((current) => ({ ...current, title: event.target.value }))}
      />

      <section className="adm-stack" aria-labelledby="adm-text-h">
        <h2 id="adm-text-h" className="adm-label">
          Lesson text
        </h2>
        <ol className="adm-list">
          {draft.blocks.map((block, index) => {
            const label = `${BLOCK_LABELS[block.kind]} ${index + 1}`;
            const fieldId = `adm-block-${block.id}`;
            return (
              <li key={block.id} className="adm-card adm-block">
                <label className="adm-label" htmlFor={fieldId}>
                  {block.kind === 'picture' ? 'Words under the picture (optional)' : block.kind === 'list' ? 'List · one line for each point' : BLOCK_LABELS[block.kind]}
                </label>
                {block.kind === 'picture' ? (
                  <>
                    <span className="adm-thumb adm-block__picture">
                      <Illustration src={block.picture.url} alt={block.picture.alt} />
                    </span>
                    <input id={fieldId} className="adm-input" type="text" maxLength={ALT_MAX} value={block.caption} onChange={(event) => patchBlock(block.id, { caption: event.target.value })} />
                  </>
                ) : block.kind === 'heading' ? (
                  <input id={fieldId} className="adm-input adm-block__heading" type="text" maxLength={TITLE_MAX} value={block.text} onChange={(event) => patchBlock(block.id, { text: event.target.value })} />
                ) : (
                  <textarea id={fieldId} className="adm-textarea" rows={block.kind === 'list' ? 3 : 4} maxLength={BLOCK_MAX} value={block.text} onChange={(event) => patchBlock(block.id, { text: event.target.value })} />
                )}
                {block.kind === 'list' ? (
                  <label className="adm-check">
                    <input type="checkbox" checked={block.ordered} onChange={(event) => patchBlock(block.id, { ordered: event.target.checked })} />
                    Number the points (1, 2, 3)
                  </label>
                ) : null}
                <div className="adm-cluster adm-block__tools">
                  <button type="button" className="adm-mini-btn" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => setBlocks((blocks) => moveItem(blocks, index, -1).slice())}>
                    <IconMoveUp size={22} />
                    Up
                  </button>
                  <button
                    type="button"
                    className="adm-mini-btn"
                    disabled={index === draft.blocks.length - 1}
                    aria-label={`Move ${label} down`}
                    onClick={() => setBlocks((blocks) => moveItem(blocks, index, 1).slice())}
                  >
                    <IconMoveDown size={22} />
                    Down
                  </button>
                  <button
                    type="button"
                    className="adm-mini-btn adm-mini-btn--danger"
                    disabled={draft.blocks.length === 1}
                    aria-label={`Remove ${label}`}
                    onClick={() => setBlocks((blocks) => blocks.filter((other) => other.id !== block.id))}
                  >
                    <IconTrash size={22} />
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        {problem && problem.field === 'blocks' ? (
          <p className="adm-inline-error" role="alert">
            {problem.message}
          </p>
        ) : null}

        <div className="adm-cluster" role="group" aria-label="Add to the lesson">
          <button type="button" className="adm-mini-btn" onClick={() => addBlock('paragraph')}>
            <IconPlus size={22} />
            Paragraph
          </button>
          <button type="button" className="adm-mini-btn" onClick={() => addBlock('heading')}>
            <IconPlus size={22} />
            Heading
          </button>
          <button type="button" className="adm-mini-btn" onClick={() => addBlock('list')}>
            <IconPlus size={22} />
            List
          </button>
          <FilePicker accept={ACCEPT_ATTR.photos} onFiles={(files) => files[0] && setPendingPicture({ file: files[0], alt: '', error: null })} className="adm-mini-btn">
            <IconPicture size={22} />
            Add picture
          </FilePicker>
        </div>

        {pendingPicture ? (
          <div className="adm-card adm-stack">
            <InputField
              label="What does the picture show?"
              hint={`For people who cannot see it. ${pendingPicture.file.name}`}
              value={pendingPicture.alt}
              maxLength={ALT_MAX}
              error={pendingPicture.error ?? addPicture.error}
              onChange={(event) => setPendingPicture({ ...pendingPicture, alt: event.target.value, error: null })}
            />
            <div className="adm-cluster">
              <Button
                size="sm"
                working={addPicture.working}
                workingLabel="Adding the picture…"
                onClick={() => {
                  if (!pendingPicture.alt.trim()) setPendingPicture({ ...pendingPicture, error: 'Say what the picture shows first.' });
                  else void addPicture.run();
                }}
              >
                Add this picture
              </Button>
              <button type="button" className="adm-mini-btn" onClick={() => setPendingPicture(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <p className="adm-row adm-row--between adm-small">
          <span>{words === 1 ? '1 word' : `${words} words`}</span>
          {kept === true ? (
            <span className="adm-note adm-note--ok">
              <IconSaved size={20} />
              <span>Kept on this phone</span>
            </span>
          ) : kept === false ? (
            <span className="adm-inline-error">This phone could not keep a copy. Tap Next soon.</span>
          ) : null}
        </p>
        <p className="adm-small">Your words are kept on this phone while you type. They are saved on the bag when you tap Next.</p>
      </section>

      <section className="adm-card adm-stack" aria-labelledby="adm-rec-h">
        <div className="adm-row adm-row--between">
          <h2 id="adm-rec-h" className="adm-h3">
            Record yourself reading it
          </h2>
          <span className="adm-chip">Optional</span>
        </div>
        <p className="adm-small">Learners can listen while they read. Good for people who find reading hard.</p>
        {draft.voice ? (
          <>
            <p className="adm-note adm-note--ok">
              <IconTick size={20} />
              <span style={{ wordBreak: 'break-all' }}>Recording added: {draft.voice.fileName}</span>
            </p>
            <button type="button" className="adm-link-btn adm-link-btn--danger" onClick={removeVoice}>
              <IconTrash size={20} />
              Remove the recording
            </button>
          </>
        ) : voice.state === 'sending' ? (
          <>
            <p className="adm-strong">Sending your recording · {percent(voice.sent, voice.total)}%</p>
            <ProgressBar value={percent(voice.sent, voice.total)} label="Recording upload" />
            <button type="button" className="adm-mini-btn" onClick={() => voiceHandle.current && voiceHandle.current.abort()}>
              <IconClose size={22} />
              Stop
            </button>
          </>
        ) : (
          <>
            {voice.state === 'failed' ? (
              <p className="adm-inline-error" role="alert">
                The recording was not added. {voice.message}
              </p>
            ) : null}
            <div className="adm-cluster">
              <FilePicker accept={ACCEPT_ATTR.audio} capture onFiles={recordChosen} className="adm-mini-btn adm-mini-btn--solid">
                <IconMicrophone size={22} />
                Record
              </FilePicker>
              <FilePicker accept={ACCEPT_ATTR.audio} onFiles={recordChosen} className="adm-mini-btn">
                <IconPlus size={22} />
                Choose a recording
              </FilePicker>
            </div>
            <p className="adm-note">
              <IconInfoMark size={20} />
              <span>Record opens your phone’s own recorder. Come back here when you have finished.</span>
            </p>
          </>
        )}
      </section>

      <section className="adm-stack" aria-labelledby="adm-see-h">
        <h2 id="adm-see-h" className="adm-h3">
          Learners will see
        </h2>
        <LessonPreview lesson={preview} />
      </section>

      {save.error ? (
        <Message tone="error" title="The lesson was not saved">
          {save.error} Your words are still on this phone.
        </Message>
      ) : null}

      {hasContent(draft) ? <ConfirmAction label="Start again" question="Throw away what you typed?" confirmLabel="Yes, start again" onConfirm={startAgain} icon={<IconPencil size={22} />} /> : null}
    </AdminFrame>
  );
}
