/*
 * Upload an animation (ADM-M-Animation): choose the package, see the bag's
 * offline checks, try it as a learner, then go on to "Where does it go?".
 *
 * The package is only ever shown inside `<iframe sandbox="allow-scripts">`:
 * it runs in its own origin, cannot read this site's cookies or storage and
 * cannot reach the admin API (the Pi also serves /media/tryit/ with its own
 * no-network CSP, see app/deploy).
 */
import { useState } from 'react';
import { adminApi, type PackageCheck } from '@shared/api';
import { Button, ButtonLink, LoadingState, Message, YouTakePart } from '@shared/components';
import { IconAnimationPackage, IconArrowRight, IconClose, IconError, IconInfoMark, IconTick, IconTryAgain, IconTryIt, IconUpload } from '@shared/icons';
import { navigate } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { FilePicker, InputField, PageHead, ProgressBar, TypeRule } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { asFile, sortChosenFiles, type RejectedFile } from '../lib/chosenFiles';
import { ACCEPT, ACCEPT_ATTR, formatBytes, formatProgress, percent, TITLE_MAX, titleFromFileName, titleProblem } from '../lib/files';
import { flowSteps } from '../lib/flow';
import { useAction, useIsLaptop, useLeaveWarning, useUploadQueue } from '../lib/hooks';
import { sessionLost, useAdminApi } from '../session';
import { RejectedList } from './UploadList';
import './animation.css';

export function checksPass(checks: readonly PackageCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.ok);
}

function CheckList({ checks }: { checks: readonly PackageCheck[] }) {
  const fine = checks.filter((check) => check.ok).length;
  return (
    <section className="adm-stack" aria-labelledby="adm-chk-h">
      <div className="adm-row adm-row--between">
        <h2 id="adm-chk-h" className="adm-h2">
          We checked it
        </h2>
        <span className={fine === checks.length ? 'adm-chip adm-chip--published' : 'adm-chip'}>
          {fine} of {checks.length} fine
        </span>
      </div>
      <ul className="adm-list">
        {checks.map((check) => (
          <li key={check.id} className={check.ok ? 'adm-card adm-row adm-row--top' : 'adm-card adm-card--problem adm-row adm-row--top'}>
            <span className={check.ok ? 'adm-disc adm-disc--ok' : 'adm-disc adm-disc--bad'} aria-hidden="true">
              {check.ok ? <IconTick size={26} /> : <IconError size={26} />}
            </span>
            <span className="adm-row__grow">
              <span className="adm-card__title">{check.title}</span>
              <span className="adm-small">{check.detail}</span>
            </span>
            <span className="adm-strong">{check.ok ? 'OK' : 'Not fine'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LearnerTest({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false);
  const setup = useAdminApi((signal) => adminApi.getTryItSetup(lessonId, { signal }), [lessonId]);
  const packageUrl = setup.data && setup.data.mode === 'package' ? setup.data.packageUrl : null;
  // Only a file served by this bag is ever framed.
  const safeUrl = packageUrl && packageUrl.charAt(0) === '/' && packageUrl.charAt(1) !== '/' ? packageUrl : null;
  return (
    <section className="adm-card adm-stack" aria-labelledby="adm-test-h">
      <h2 id="adm-test-h" className="adm-h2">
        Test as a learner
      </h2>
      <p className="adm-small">Tap around like a learner would. Nothing is saved.</p>
      {setup.loading && !setup.data ? (
        <LoadingState label="Getting the animation ready…" />
      ) : !safeUrl ? (
        <p className="adm-note">
          <IconInfoMark size={20} />
          <span>The preview is not ready yet. You can go on and test it after you publish.</span>
        </p>
      ) : open ? (
        <>
          <div className="adm-tryframe">
            <iframe src={safeUrl} title="Animation preview" sandbox="allow-scripts" />
          </div>
          <button type="button" className="adm-mini-btn" onClick={() => setOpen(false)}>
            <IconClose size={22} />
            Close the test
          </button>
        </>
      ) : (
        <Button variant="secondary" size="sm" fullWidth icon={<IconTryIt size={26} />} onClick={() => setOpen(true)}>
          Test it here
        </Button>
      )}
    </section>
  );
}

export default function Animation() {
  const laptop = useIsLaptop();
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);

  const { queue, items, running } = useUploadQueue(() => ({
    send: (item, onProgress) => adminApi.uploadContent(asFile(item.file, item.name), {}, onProgress),
    afterUpload: async (item, upload) => {
      // A package that failed a check is not turned into a lesson.
      if (!checksPass(upload.checks)) return null;
      const lesson = await adminApi.createLesson({ source: 'animation', title: titleFromFileName(item.name), uploadIds: [upload.id] }, { idempotencyKey: item.requestKey });
      return lesson.id;
    },
    onUnauthorised: sessionLost,
  }));
  const item = items[0];
  const lessonId = item && item.state === 'done' ? item.resultId : null;
  useLeaveWarning(Boolean(item) && item?.state !== 'done');

  const choose = (files: File[]) => {
    const sorted = sortChosenFiles(files.slice(0, 1), {
      accept: ACCEPT.animation,
      already: [],
      room: 1,
      wrongKind: (kind) => (kind === 'video' ? 'A plain animation video goes through “Upload files”. It becomes a Watch lesson.' : 'Choose an animation package (.zip) or an H5P file (.h5p).'),
    });
    setRejected(sorted.rejected);
    const file = sorted.accepted[0];
    if (!file) return;
    queue.getItems().forEach((old) => queue.remove(old.key));
    queue.add([{ file, name: file.name }]);
    setTitle(titleFromFileName(file.name));
    setTitleError(null);
    queue.start();
  };

  const change = useAction(async () => {
    // The draft made from the old file would otherwise be left waiting on Home.
    if (lessonId) await adminApi.deleteLesson(lessonId);
    queue.getItems().forEach((old) => queue.remove(old.key));
    setTitle('');
  });

  const next = useAction(async () => {
    if (!lessonId || !item) return;
    if (title.trim() !== titleFromFileName(item.name)) await adminApi.updateLesson(lessonId, { title: title.trim() });
    navigate(adminPaths.place(lessonId));
  });
  const goNext = () => {
    const problem = titleProblem(title);
    setTitleError(problem);
    if (!problem) void next.run();
  };

  const checks = item && item.upload ? item.upload.checks : [];
  const failedChecks = checks.filter((check) => !check.ok);

  let action;
  if (lessonId) {
    action = (
      <Button fullWidth working={next.working} workingLabel="Saving…" iconAfter={<IconArrowRight size={26} />} onClick={goNext}>
        Next: choose where it goes
      </Button>
    );
  } else if (item && (item.state === 'uploading' || item.state === 'saving' || running)) {
    action = (
      <Button fullWidth working workingLabel="Uploading and checking…">
        Next: choose where it goes
      </Button>
    );
  } else {
    action = (
      <Button fullWidth notReady icon={<IconUpload size={26} />}>
        {item && item.state === 'done' ? 'This file cannot be used yet' : 'Choose the animation file first'}
      </Button>
    );
  }

  return (
    <AdminFrame title="Upload an animation" nav="add" back={{ to: laptop ? adminPaths.add() : adminPaths.home() }} steps={flowSteps('add', laptop)} action={action}>
      <PageHead title="Upload an animation" lead="EasySTEM made it and sent it to you. Learners tap and take part." />

      {!item ? (
        <>
          <section className="adm-stack" aria-labelledby="adm-acc-h">
            <h2 id="adm-acc-h" className="adm-h2">
              What you can upload
            </h2>
            <div className="adm-card adm-row adm-row--top">
              <span className="adm-disc" aria-hidden="true">
                <IconAnimationPackage size={26} />
              </span>
              <span className="adm-row__grow">
                <span className="adm-card__title">Animation package (.zip)</span>
                <span className="adm-small">Made by EasySTEM. It has an index.html file inside.</span>
                <span className="adm-note adm-note--ok">
                  <IconTick size={20} />
                  <span>Works on this bag</span>
                </span>
              </span>
            </div>
            <div className="adm-card adm-row adm-row--top">
              <span className="adm-disc adm-disc--muted" aria-hidden="true">
                <IconAnimationPackage size={26} />
              </span>
              <span className="adm-row__grow">
                <span className="adm-card__title">H5P file (.h5p)</span>
                <span className="adm-small">An interactive file made with H5P.</span>
                <span className="adm-note">
                  <IconInfoMark size={20} />
                  <span>Needs the H5P player on this bag — ask EasySTEM</span>
                </span>
              </span>
            </div>
            <p className="adm-note">
              <IconInfoMark size={20} />
              <span>A plain animation video (MP4)? Use Upload files — it becomes a Watch lesson.</span>
            </p>
            <ButtonLink to={adminPaths.addUpload()} variant="secondary" size="sm" fullWidth icon={<IconUpload size={24} />}>
              Use Upload files
            </ButtonLink>
          </section>
          <FilePicker accept={ACCEPT_ATTR.animation} onFiles={choose} className="sb-btn sb-btn--full sb-btn--lg">
            <IconUpload size={28} />
            <span>Choose the animation file</span>
          </FilePicker>
          <p className="adm-small">.zip or .h5p from your phone’s files</p>
        </>
      ) : null}

      <RejectedList rejected={rejected} onDismiss={() => setRejected([])} />

      {item ? (
        <section className="adm-card adm-stack" aria-label="Chosen file">
          <div className="adm-row adm-row--top">
            <span className="adm-disc" aria-hidden="true">
              <IconAnimationPackage size={26} />
            </span>
            <div className="adm-row__grow">
              <p className="adm-small">Chosen file</p>
              <p className="adm-card__title" style={{ wordBreak: 'break-all' }}>
                {item.name}
              </p>
              <p className="adm-small">
                {formatBytes(item.sizeBytes)} · {item.info.label}
              </p>
            </div>
          </div>
          {item.state === 'uploading' ? (
            <>
              <p className="adm-strong">
                {formatProgress(item.sentBytes, item.totalBytes)} · {percent(item.sentBytes, item.totalBytes)}%
              </p>
              <ProgressBar value={percent(item.sentBytes, item.totalBytes)} label="Animation upload" />
              <p className="adm-small">Keep this page open while it uploads.</p>
              <button type="button" className="adm-mini-btn adm-mini-btn--danger" onClick={() => queue.stop()}>
                <IconClose size={22} />
                Stop uploading
              </button>
            </>
          ) : null}
          {item.state === 'saving' ? <LoadingState label="Checking it and saving a draft…" /> : null}
          {item.state === 'waiting' && !running ? (
            <>
              <p className="adm-strong">Uploading stopped. Nothing was added.</p>
              <Button size="sm" variant="danger" icon={<IconTryAgain size={24} />} onClick={() => queue.start()}>
                Upload it again
              </Button>
            </>
          ) : null}
          {item.state === 'failed' ? (
            <>
              <p className="adm-inline-error" role="alert">
                Not uploaded. {item.error}
              </p>
              {item.retryable ? (
                <Button size="sm" variant="danger" icon={<IconTryAgain size={24} />} onClick={() => queue.start()}>
                  Try again
                </Button>
              ) : null}
            </>
          ) : null}
          {!running && item.state !== 'saving' ? (
            <button type="button" className="adm-link-btn" aria-busy={change.working || undefined} onClick={() => void change.run()}>
              {change.working ? 'Removing…' : 'Change the file'}
            </button>
          ) : null}
          {change.error ? (
            <p className="adm-inline-error" role="alert">
              {change.error}
            </p>
          ) : null}
        </section>
      ) : null}

      {checks.length > 0 ? <CheckList checks={checks} /> : null}

      {item && item.state === 'done' && failedChecks.length > 0 ? (
        <Message tone="error" title="This file cannot be used yet">
          {failedChecks.map((check) => `${check.title}. ${check.detail}`).join(' ')} Ask EasySTEM for a version that works on the bag, then choose the new file.
        </Message>
      ) : null}

      {lessonId ? (
        <>
          <Message tone="success" title="Saved on this bag as a draft">
            Learners cannot see it yet.
          </Message>
          <LearnerTest lessonId={lessonId} />
          <InputField
            label="Title learners will see"
            value={title}
            maxLength={TITLE_MAX}
            error={titleError ?? next.error}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(null);
            }}
          />
          <section className="adm-card adm-stack--sm" aria-label="Lesson type">
            <p className="adm-label">Lesson type</p>
            <p className="adm-chips">
              <span className="adm-row adm-strong">
                <span className="adm-disc adm-disc--sm" aria-hidden="true">
                  <IconTryIt size={18} />
                </span>
                <span>Try it</span>
              </span>
              <YouTakePart />
            </p>
            <p className="adm-small">Set for you: an animation package becomes a Try it lesson. Learners tap “Start”.</p>
            <TypeRule />
          </section>
        </>
      ) : null}
    </AdminFrame>
  );
}
