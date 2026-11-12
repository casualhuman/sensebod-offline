/*
 * Upload your notes (ADM-M-Notes): photos of handwritten pages, in order, or
 * one PDF or Word file. Both become a Read lesson.
 *
 * Photos come from `<input type="file" capture>`: the bag is served over
 * plain HTTP, where a live camera view inside the page is blocked by the
 * browser (ARCHITECTURE section 10). The input opens the phone's own camera.
 */
import { useEffect, useRef, useState } from 'react';
import { adminApi, ApiError, newRequestKey, type Upload, type UploadHandle } from '@shared/api';
import { Button, Message } from '@shared/components';
import { IconArrowRight, IconCamera, IconChevronRight, IconClose, IconDocument, IconInfoMark, IconPlus, IconRead, IconTick, IconTrash, IconTryAgain } from '@shared/icons';
import { navigate } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { FilePicker, InputField, PageHead, ProgressBar, TypeRule } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconChevronLeft, IconRotate, IconTip } from '../icons';
import { asFile, MAX_FILES_AT_ONCE, sortChosenFiles, type RejectedFile } from '../lib/chosenFiles';
import { ACCEPT, ACCEPT_ATTR, fileIdentity, formatBytes, percent, TITLE_MAX, titleFromFileName, titleProblem } from '../lib/files';
import { flowSteps } from '../lib/flow';
import { useAction, useIsLaptop, useLeaveWarning, useObjectUrl, useUploadQueue } from '../lib/hooks';
import { nextRotation, rotatedName, rotateImage, type Rotation } from '../lib/rotateImage';
import { summariseQueue, type QueueItem } from '../lib/uploadQueue';
import { sessionLost } from '../session';
import { KeepOpenCard, RejectedList } from './UploadList';
import './notes.css';

function PageThumb({ file, rotation, label }: { file: Blob; rotation: Rotation; label: string }) {
  const url = useObjectUrl(file);
  return <span className="adm-page__thumb">{url ? <img src={url} alt={label} style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined} /> : null}</span>;
}

export default function Notes() {
  const laptop = useIsLaptop();
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rotations, setRotations] = useState<Record<string, Rotation>>({});
  const rotationsRef = useRef(rotations);
  rotationsRef.current = rotations;
  const [started, setStarted] = useState(false);
  /** One key for this lesson: repeating "Next" after a lost answer cannot make two lessons. */
  const requestKey = useRef(newRequestKey());

  const { queue, items, running } = useUploadQueue(() => ({
    send: (item, onProgress): UploadHandle<Upload> => {
      const rotation = rotationsRef.current[item.key] ?? 0;
      if (rotation === 0) return adminApi.uploadContent(asFile(item.file, item.name), {}, onProgress);
      let inner: UploadHandle<Upload> | null = null;
      let aborted = false;
      const promise = rotateImage(item.file, rotation).then(
        (turned) => {
          if (aborted) throw new ApiError('aborted', 'Cancelled.');
          inner = adminApi.uploadContent(asFile(turned, rotatedName(item.name)), {}, onProgress);
          return inner.promise;
        },
        () => {
          throw new ApiError('http', 'This phone could not turn this photo. Remove it, turn the paper and take the photo again.', 422);
        },
      );
      return {
        promise,
        abort: () => {
          aborted = true;
          if (inner) inner.abort();
        },
      };
    },
    poll: (uploadId) => adminApi.getUpload(uploadId),
    onUnauthorised: sessionLost,
  }));

  const summary = summariseQueue(items);
  const isDocument = items.length > 0 && items[0] !== undefined && items[0].info.kind !== 'photo';
  const count = items.length;
  useLeaveWarning(count > 0);

  const create = useAction(async () => {
    const uploadIds = queue.getItems().map((item) => (item.upload ? item.upload.id : ''));
    const lesson = await adminApi.createLesson(
      isDocument ? { source: 'upload', title: title.trim(), uploadIds } : { source: 'notes-photos', title: title.trim(), uploadIds },
      { idempotencyKey: requestKey.current },
    );
    navigate(adminPaths.place(lesson.id));
  });

  // When the last page has arrived, make the lesson. `create` ignores a second call while one is running.
  const createRun = create.run;
  const createFailed = create.error !== null;
  useEffect(() => {
    if (started && summary.allDone && !createFailed) void createRun();
  }, [started, summary.allDone, createFailed, createRun]);

  const addPhotos = (files: File[]) => {
    if (isDocument) return;
    const sorted = sortChosenFiles(files, {
      accept: ACCEPT.photos,
      already: queue.getItems().map((item) => fileIdentity(asFile(item.file, item.name))),
      room: MAX_FILES_AT_ONCE - queue.getItems().length,
      wrongKind: () => 'Only photos can be pages. For a PDF or Word file use the second button.',
    });
    setRejected(sorted.rejected);
    const keys = queue.add(sorted.accepted.map((file) => ({ file, name: file.name })));
    const last = keys[keys.length - 1];
    if (last) setSelected(last);
  };

  const addDocument = (files: File[]) => {
    const sorted = sortChosenFiles(files.slice(0, 1), { accept: ACCEPT.notesDocument, already: [], room: 1, wrongKind: () => 'Choose a PDF or Word file (.pdf, .docx, .doc).' });
    setRejected(sorted.rejected);
    const file = sorted.accepted[0];
    if (!file) return;
    queue.getItems().forEach((item) => queue.remove(item.key));
    queue.add([{ file, name: file.name }]);
    setSelected(null);
    setRotations({});
    if (!title.trim()) setTitle(titleFromFileName(file.name));
  };

  const remove = (key: string) => {
    queue.remove(key);
    if (selected === key) setSelected(null);
  };

  const next = () => {
    const problem = titleProblem(title);
    setTitleError(problem);
    if (problem || count === 0) return;
    create.clearError();
    if (summary.allDone) void create.run();
    else if (queue.start()) setStarted(true);
  };

  const selectedIndex = items.findIndex((item) => item.key === selected);
  const selectedItem: QueueItem | undefined = selectedIndex === -1 ? undefined : items[selectedIndex];
  const locked = running || create.working;
  const busy = running || create.working;
  const failed = summary.failed > 0;

  let action;
  if (count === 0) {
    action = (
      <Button fullWidth notReady icon={<IconCamera size={26} />}>
        Add your notes first
      </Button>
    );
  } else if (busy) {
    action = (
      <Button fullWidth working workingLabel={create.working ? 'Saving the lesson…' : `Uploading ${Math.min(count, summary.done + 1)} of ${count}…`}>
        Next: choose where it goes
      </Button>
    );
  } else if (started && (failed || create.error)) {
    action = (
      <Button fullWidth variant="danger" icon={<IconTryAgain size={26} />} onClick={next}>
        Try again
      </Button>
    );
  } else {
    action = (
      <Button fullWidth iconAfter={<IconArrowRight size={26} />} onClick={next}>
        Next: choose where it goes
      </Button>
    );
  }

  return (
    <AdminFrame title="Upload your notes" nav="add" back={{ to: laptop ? adminPaths.add() : adminPaths.home() }} steps={flowSteps('add', laptop)} action={action}>
      <PageHead title="Upload your notes" lead="Photos of handwritten notes, or a PDF or Word file. Learners will read them." />
      <p className="sb-visually-hidden" role="status">
        {started ? `${summary.done} of ${count} uploaded` : ''}
      </p>

      {count === 0 || !isDocument ? (
        <div className="adm-stack">
          <FilePicker accept={ACCEPT_ATTR.photos} capture="environment" onFiles={addPhotos} disabled={locked} className="adm-card adm-card--tappable adm-row">
            <span className="adm-tile" aria-hidden="true">
              <IconCamera size={36} />
            </span>
            <span className="adm-row__grow">
              <span className="adm-card__title">{count === 0 ? 'Take photos of your notes' : 'Take another photo'}</span>
              <span className="adm-small">One photo for each page. Opens your camera.</span>
            </span>
            <IconChevronRight size={26} />
          </FilePicker>
          <FilePicker accept={ACCEPT_ATTR.photos} multiple onFiles={addPhotos} disabled={locked} className="adm-mini-btn">
            <IconPlus size={22} />
            Add photos already on your phone
          </FilePicker>
        </div>
      ) : null}
      {count === 0 || isDocument ? (
        <FilePicker accept={ACCEPT_ATTR.notesDocument} onFiles={addDocument} disabled={locked} className="adm-card adm-card--tappable adm-row">
          <span className="adm-tile" aria-hidden="true">
            <IconDocument size={36} />
          </span>
          <span className="adm-row__grow">
            <span className="adm-card__title">{isDocument ? 'Choose a different file' : 'Choose a PDF or Word file'}</span>
            <span className="adm-small">From your phone’s files. Also .docx and .doc.</span>
          </span>
          <IconChevronRight size={26} />
        </FilePicker>
      ) : null}

      <RejectedList rejected={rejected} onDismiss={() => setRejected([])} />

      {isDocument && items[0] ? (
        <section className="adm-card adm-stack" aria-label="Chosen file">
          <div className="adm-row adm-row--top">
            <span className={items[0].state === 'done' ? 'adm-disc adm-disc--ok' : 'adm-disc'} aria-hidden="true">
              {items[0].state === 'done' ? <IconTick size={26} /> : <IconDocument size={26} />}
            </span>
            <div className="adm-row__grow">
              <p className="adm-card__title" style={{ wordBreak: 'break-all' }}>
                {items[0].name}
              </p>
              <p className="adm-small">
                {items[0].info.label} · {formatBytes(items[0].sizeBytes)} · Pages will be ready to read on any phone.
              </p>
            </div>
          </div>
          {items[0].state === 'uploading' ? <ProgressBar value={percent(items[0].sentBytes, items[0].totalBytes)} label={`${items[0].name} upload`} /> : null}
          {items[0].state === 'failed' ? (
            <p className="adm-inline-error" role="alert">
              Not uploaded. {items[0].error}
            </p>
          ) : null}
          {!locked ? (
            <button type="button" className="adm-link-btn adm-link-btn--danger" onClick={() => remove((items[0] as QueueItem).key)}>
              <IconTrash size={20} />
              Remove
            </button>
          ) : null}
        </section>
      ) : null}

      {!isDocument && count > 0 ? (
        <section className="adm-card adm-stack" aria-labelledby="adm-pages-h">
          <h2 id="adm-pages-h" className="adm-h3">
            {count === 1 ? '1 photo added' : `${count} photos added`} · {formatBytes(summary.totalBytes)}
          </h2>
          <p className="adm-small">Learners see the pages in this order. Tap a page, then move or turn it.</p>
          <ol className="adm-pages">
            {items.map((item, index) => {
              const isSelected = item.key === selected;
              const pct = percent(item.sentBytes, item.totalBytes);
              return (
                <li key={item.key}>
                  <button type="button" className={isSelected ? 'adm-page adm-page--selected' : 'adm-page'} aria-pressed={isSelected} onClick={() => setSelected(isSelected ? null : item.key)}>
                    <PageThumb file={item.file} rotation={item.upload ? 0 : (rotations[item.key] ?? 0)} label="" />
                    <span className="adm-page__name">Page {index + 1}</span>
                    <span className="adm-page__state">
                      {item.state === 'done' ? 'Uploaded' : item.state === 'uploading' ? `${pct}%` : item.state === 'failed' ? 'Not uploaded' : isSelected ? 'Selected' : 'Tap to select'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {items
            .filter((item) => item.state === 'failed')
            .map((item) => (
              <p key={item.key} className="adm-inline-error" role="alert">
                Page {items.indexOf(item) + 1} was not uploaded. {item.error}
              </p>
            ))}
          {selectedItem ? (
            <div className="adm-stack--sm">
              <p className="adm-strong" aria-live="polite">
                Page {selectedIndex + 1} selected
              </p>
              <div className="adm-cluster">
                <button type="button" className="adm-mini-btn" disabled={locked || selectedIndex === 0} onClick={() => queue.move(selectedItem.key, -1)}>
                  <IconChevronLeft size={22} />
                  Move left
                </button>
                <button type="button" className="adm-mini-btn" disabled={locked || selectedIndex === count - 1} onClick={() => queue.move(selectedItem.key, 1)}>
                  <IconChevronRight size={22} />
                  Move right
                </button>
                <button
                  type="button"
                  className="adm-mini-btn"
                  disabled={locked || selectedItem.upload !== null}
                  onClick={() => setRotations((all) => ({ ...all, [selectedItem.key]: nextRotation(all[selectedItem.key] ?? 0) }))}
                >
                  <IconRotate size={22} />
                  Rotate
                </button>
                <button type="button" className="adm-mini-btn adm-mini-btn--danger" disabled={locked} onClick={() => remove(selectedItem.key)}>
                  <IconClose size={22} />
                  Remove page
                </button>
              </div>
              {selectedItem.upload ? <p className="adm-small">This page is already on the bag, so it cannot be turned any more. Remove it and add it again to change it.</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {running ? (
        <>
          <KeepOpenCard />
          <Button variant="danger-outline" fullWidth icon={<IconClose size={26} />} onClick={() => queue.stop()}>
            Stop uploading
          </Button>
        </>
      ) : null}
      {create.error ? (
        <Message tone="error" title="The lesson was not saved">
          {create.error} Your pages are still on the bag. Tap Try again.
        </Message>
      ) : null}

      {!isDocument ? (
        <div className="adm-card adm-row adm-row--top">
          <IconTip size={26} />
          <div className="adm-row__grow">
            <p className="adm-strong">Tip: Take the photo flat, in good light</p>
            <p className="adm-small">Lay the page on a table, hold the phone straight above it, and keep your shadow off the page.</p>
          </div>
        </div>
      ) : null}

      <InputField
        label="Title learners will see"
        hint="Short and clear. You can change it later."
        value={title}
        maxLength={TITLE_MAX}
        error={titleError}
        disabled={locked}
        onChange={(event) => {
          setTitle(event.target.value);
          if (titleError) setTitleError(null);
        }}
      />

      <section className="adm-card adm-stack--sm" aria-label="Lesson type">
        <p className="adm-label">Lesson type</p>
        <p className="adm-row adm-strong">
          <span className="adm-disc adm-disc--sm" aria-hidden="true">
            <IconRead size={18} />
          </span>
          <span>Read</span>
        </p>
        <p className="adm-note">
          <IconInfoMark size={20} />
          <span>Set for you: notes become a Read lesson. Learners tap “Read”. You can change it on the next step.</span>
        </p>
        <TypeRule />
      </section>
    </AdminFrame>
  );
}
