/*
 * Upload files (ADM-M-Upload on a phone, ADM-Add-2 on a laptop).
 *
 * Choose files → tap Next → they are sent one at a time with progress →
 * each finished file is saved on the bag as a draft lesson at once, so a
 * dropped connection, a refresh or a dead battery never loses a file that
 * already arrived. The first draft then goes on to "Where does it go?"; the
 * others wait on Home under "Waiting to be placed".
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { adminApi } from '@shared/api';
import { Button, ButtonLink, Message } from '@shared/components';
import { IconArrowRight, IconClose, IconInfoMark, IconPlus, IconTryAgain, IconUpload } from '@shared/icons';
import { Link } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { FilePicker, PageHead, Switch } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { asFile, MAX_FILES_AT_ONCE, sortChosenFiles, type RejectedFile } from '../lib/chosenFiles';
import { ACCEPT, ACCEPT_ATTR, fileIdentity, formatBytes, titleFromFileName } from '../lib/files';
import { flowSteps, takeHandedOverFiles } from '../lib/flow';
import { useIsLaptop, useLeaveWarning, useUploadQueue } from '../lib/hooks';
import { summariseQueue } from '../lib/uploadQueue';
import { sessionLost } from '../session';
import { KeepOpenCard, RejectedList, UploadRows } from './UploadList';

const BIG_BYTES = 10 * 1024 * 1024;

export default function Upload() {
  const laptop = useIsLaptop();
  const [smallerCopy, setSmallerCopy] = useState(true);
  const smallerCopyRef = useRef(smallerCopy);
  smallerCopyRef.current = smallerCopy;
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);

  const { queue, items, running } = useUploadQueue(() => ({
    send: (item, onProgress) => adminApi.uploadContent(asFile(item.file, item.name), { smallerCopy: item.info.kind === 'video' && smallerCopyRef.current }, onProgress),
    afterUpload: async (item, upload) => {
      const lesson = await adminApi.createLesson({ source: 'upload', title: titleFromFileName(item.name), uploadIds: [upload.id] }, { idempotencyKey: item.requestKey });
      return lesson.id;
    },
    poll: (uploadId) => adminApi.getUpload(uploadId),
    onUnauthorised: sessionLost,
  }));

  const summary = summariseQueue(items);
  const unfinished = items.some((item) => item.state !== 'done');
  useLeaveWarning(items.length > 0 && unfinished);

  const addFiles = (files: File[]) => {
    const sorted = sortChosenFiles(files, {
      accept: ACCEPT.uploadFiles,
      already: queue.getItems().map((item) => fileIdentity(asFile(item.file, item.name))),
      room: MAX_FILES_AT_ONCE - queue.getItems().length,
      wrongKind: (kind) => (kind === 'animation' || kind === 'h5p' ? 'Animation packages have their own checks. Use “Upload an animation”.' : null),
    });
    setRejected(sorted.rejected);
    queue.add(sorted.accepted.map((file) => ({ file, name: file.name })));
  };

  // Files dropped on "Where is your content from?" arrive here.
  useEffect(() => {
    const handed = takeHandedOverFiles();
    if (handed.length > 0) addFiles(handed);
    // Runs once: the hand-over is emptied by reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (queue.start()) setStarted(true);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const list = event.dataTransfer.files;
    const files: File[] = [];
    for (let i = 0; i < list.length; i += 1) files.push(list[i] as File);
    if (files.length > 0) addFiles(files);
  };

  const hasVideo = items.some((item) => item.info.kind === 'video');
  const hasVoice = items.some((item) => item.info.kind === 'voice-note');
  const firstDone = items.find((item) => item.state === 'done' && item.resultId);
  const count = summary.total;
  const filesWord = count === 1 ? '1 file' : `${count} files`;

  let heading = 'Choose files from your phone';
  if (started && summary.allDone) heading = count === 1 ? 'Your file is on the bag' : `All ${count} files are on the bag`;
  else if (started && running && summary.active) heading = `Uploading ${summary.activeNumber} of ${count}`;
  else if (started && summary.failed > 0) heading = summary.failed === 1 ? '1 file was not uploaded' : `${summary.failed} files were not uploaded`;
  else if (started) heading = 'Uploading stopped';

  let action;
  if (count === 0) {
    action = (
      <Button fullWidth notReady icon={<IconUpload size={26} />}>
        Choose files first
      </Button>
    );
  } else if (!started) {
    action = (
      <>
        <p className="adm-actionbar__note">{count} chosen · uploading starts when you tap Next</p>
        <Button fullWidth iconAfter={<IconArrowRight size={26} />} onClick={start}>
          Next: choose where it goes
        </Button>
      </>
    );
  } else if (summary.allDone && firstDone && firstDone.resultId) {
    action = (
      <ButtonLink to={adminPaths.place(firstDone.resultId)} fullWidth iconAfter={<IconArrowRight size={26} />}>
        Next: choose where it goes
      </ButtonLink>
    );
  } else if (running) {
    action = (
      <>
        <p className="adm-actionbar__note">Ready when {count === 1 ? 'the file is' : `all ${count} files are`} uploaded</p>
        <Button fullWidth working workingLabel={`Uploading ${summary.done + 1} of ${count}…`}>
          Next: choose where it goes
        </Button>
      </>
    );
  } else {
    action = (
      <>
        <p className="adm-actionbar__note">
          {summary.done} of {count} uploaded. Nothing that arrived is lost.
        </p>
        <Button fullWidth variant="danger" icon={<IconTryAgain size={26} />} onClick={start}>
          {summary.failed > 0 ? 'Try again' : 'Carry on uploading'}
        </Button>
        {firstDone && firstDone.resultId ? (
          <ButtonLink to={adminPaths.place(firstDone.resultId)} variant="secondary" size="sm" fullWidth>
            Go on with what is uploaded
          </ButtonLink>
        ) : null}
      </>
    );
  }

  const picker = (label: string, className: string) => (
    <FilePicker accept={ACCEPT_ATTR.uploadFiles} multiple onFiles={addFiles} className={className}>
      {count === 0 ? <IconUpload size={26} /> : <IconPlus size={24} />}
      <span>{label}</span>
    </FilePicker>
  );

  return (
    <AdminFrame title="Upload files" nav="add" back={{ to: laptop ? adminPaths.add() : adminPaths.home(), label: laptop ? 'Back' : 'Back to Home' }} steps={flowSteps('add', laptop)} action={action}>
      <PageHead eyebrow="Upload files" title={heading} />
      {/* Screen readers hear the milestones, not every percent. */}
      <p className="sb-visually-hidden" role="status">
        {started ? `${summary.done} of ${count} uploaded${summary.failed > 0 ? `, ${summary.failed} not uploaded` : ''}` : ''}
      </p>

      {!started ? (
        <div
          className={laptop ? (over ? 'adm-drop adm-drop--over' : 'adm-drop') : undefined}
          onDragOver={
            laptop
              ? (event) => {
                  event.preventDefault();
                  setOver(true);
                }
              : undefined
          }
          onDragLeave={laptop ? () => setOver(false) : undefined}
          onDrop={laptop ? onDrop : undefined}
        >
          {laptop ? <p className="adm-h3">Drop files here, or</p> : null}
          {count === 0 ? picker('Choose files', 'sb-btn sb-btn--full sb-btn--lg') : picker('Add more files', 'sb-btn sb-btn--secondary sb-btn--full')}
          <p className="adm-small" style={{ marginTop: 10 }}>
            You can choose more than one. Videos, voice notes and other audio, PDF, Word and photos. Each file becomes its own lesson.
          </p>
        </div>
      ) : null}

      <RejectedList rejected={rejected} onDismiss={() => setRejected([])} />

      {count > 0 ? (
        <section aria-labelledby="adm-chosen-h" className="adm-stack">
          <div className="adm-row adm-row--between">
            <h2 id="adm-chosen-h" className="adm-h2">
              {started ? filesWord : `${count} chosen`}
            </h2>
            <span className="adm-small">about {formatBytes(summary.totalBytes)}</span>
          </div>
          {!started ? <p className="adm-small">The type is set for you. You can change it on the next steps.</p> : null}
          <UploadRows items={items} started={started} smallerCopy={smallerCopy} onRemove={(key) => queue.remove(key)} />
        </section>
      ) : null}

      {started && running ? (
        <>
          <KeepOpenCard />
          <Button variant="danger-outline" fullWidth icon={<IconClose size={26} />} onClick={() => queue.stop()}>
            Stop uploading
          </Button>
        </>
      ) : null}

      {started && summary.allDone ? (
        <Message tone="success" title={count === 1 ? 'Saved on this bag as a draft' : `${count} drafts saved on this bag`}>
          {count === 1 ? 'Learners cannot see it yet. Choose where it goes next.' : 'Learners cannot see them yet. Place the first one now; the others wait on Home under “Waiting to be placed”.'}
        </Message>
      ) : null}

      {!started && count > 0 ? (
        <div className="adm-stack">
          {hasVoice ? (
            <p className="adm-note">
              <IconInfoMark size={20} />
              <span>Voice notes will be converted so every phone can play them.</span>
            </p>
          ) : null}
          {hasVideo ? <Switch label="Make a smaller copy for old phones" detail="For the video. Plays well on slow phones." checked={smallerCopy} onChange={setSmallerCopy} /> : null}
          {summary.totalBytes >= BIG_BYTES ? (
            <p className="adm-note adm-note--warn">
              <IconInfoMark size={20} />
              <span>{formatBytes(summary.totalBytes)} may take a few minutes. Keep this page open while it uploads.</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {laptop && !started ? (
        <section aria-labelledby="adm-extras-h" className="adm-card adm-stack">
          <h2 id="adm-extras-h" className="adm-h3">
            Extras
          </h2>
          <p className="adm-small">
            <strong className="adm-strong">Cover picture:</strong> you choose it on the next step, from the picture gallery.
          </p>
          <p className="adm-small">
            <strong className="adm-strong">Captions:</strong> not available yet. This bag cannot take caption files (.vtt or .srt) for now.
          </p>
          <p className="adm-small">
            <strong className="adm-strong">An animation package?</strong> <Link to={adminPaths.addAnimation()}>Use Upload an animation</Link>
          </p>
        </section>
      ) : null}
    </AdminFrame>
  );
}
