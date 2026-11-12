/*
 * Try it setup (ADM-TryIt): either an uploaded animation package, or a scene
 * picture with spots that learners tap to hear a person speak.
 *
 * Spots are placed without drag-and-drop: tap the picture to put the
 * selected spot there, or use the arrow and size buttons. That works by
 * touch, mouse and keyboard on every browser down to the floor.
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { adminApi, describeError, isAbort, type AdminLesson, type PackageCheck, type TryItSetup, type Upload, type UploadHandle } from '@shared/api';
import { Button, ErrorState, Illustration, LESSON_TYPES, LessonTypeIcon, LoadingState, Message, YouTakePart } from '@shared/components';
import { IconInfoMark, IconPlus, IconSave, IconTick, IconTrash, IconUpload } from '@shared/icons';
import { Link, paths, useParams } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { FilePicker, InputField, OptionRow, PageHead, ProgressBar, SelectField, StatusChip, Switch, TextAreaField } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconChevronLeft, IconEye, IconMoveDown, IconMoveUp } from '../icons';
import { ACCEPT, classifyFileName, percent } from '../lib/files';
import { useAction, useLeaveWarning, useObjectUrl } from '../lib/hooks';
import { noteAdminError, useAdminApi } from '../session';
import { checksPass } from './Animation';
import './questions.css';

type Hotspots = Extract<TryItSetup, { mode: 'hotspots' }>;
type Spot = Hotspots['spots'][number] & { audioName?: string };

const MAX_SPOTS = 8;
const STEP = 2;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.round(value * 10) / 10));
}

let spotCounter = 0;
function newSpot(x: number, y: number): Spot {
  spotCounter += 1;
  return { id: `spot-${Date.now().toString(36)}-${spotCounter}`, label: '', role: '', says: '', audioUrl: null, portrait: null, x, y, r: 9 };
}

/** One file to the bag with progress; used for the scene, a spot's audio and a new package. */
function useSingleUpload() {
  const [state, setState] = useState<{ sending: boolean; sent: number; total: number; error: string | null }>({ sending: false, sent: 0, total: 0, error: null });
  const handle = useRef<UploadHandle<Upload> | null>(null);
  useEffect(() => () => handle.current?.abort(), []);
  const send = (file: File): Promise<Upload | null> => {
    if (handle.current) return Promise.resolve(null);
    setState({ sending: true, sent: 0, total: file.size, error: null });
    const started = adminApi.uploadContent(file, {}, (sent, total) => setState({ sending: true, sent, total, error: null }));
    handle.current = started;
    return started.promise.then(
      (upload) => {
        handle.current = null;
        setState({ sending: false, sent: 0, total: 0, error: null });
        return upload;
      },
      (error: unknown) => {
        handle.current = null;
        setState({ sending: false, sent: 0, total: 0, error: isAbort(error) || noteAdminError(error) ? null : describeError(error) });
        return null;
      },
    );
  };
  const fail = (message: string) => setState({ sending: false, sent: 0, total: 0, error: message });
  return { ...state, send, fail, stop: () => handle.current?.abort() };
}

function SetupForm({ lesson, initial }: { lesson: AdminLesson; initial: TryItSetup }) {
  const [mode, setMode] = useState<TryItSetup['mode']>(initial.mode);
  const startHot = initial.mode === 'hotspots' ? initial : null;
  const startPack = initial.mode === 'package' ? initial : null;
  const [spots, setSpots] = useState<Spot[]>(() => (startHot ? startHot.spots.map((spot) => ({ ...spot })) : []));
  const [selectedId, setSelectedId] = useState<string | null>(startHot?.spots[0]?.id ?? null);
  const [instruction, setInstruction] = useState(startHot?.instruction ?? '');
  const [goal, setGoal] = useState<'all' | 'any'>(startHot?.goal ?? 'all');
  const [finishMessage, setFinishMessage] = useState(startHot?.finishMessage ?? '');
  const [gentle, setGentle] = useState(startHot?.gentleMovement ?? true);
  const scene = startHot?.scene ?? null;
  const [sceneFile, setSceneFile] = useState<{ file: File; uploadId: string } | null>(null);
  const [pack, setPack] = useState<{ uploadId: string | null; packageUrl: string | null; checks: PackageCheck[]; name: string | null }>({
    uploadId: null,
    packageUrl: startPack?.packageUrl ?? null,
    checks: startPack?.checks ?? [],
    name: null,
  });
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const sceneUrl = useObjectUrl(sceneFile ? sceneFile.file : null);
  const sceneUpload = useSingleUpload();
  const audioUpload = useSingleUpload();
  const packUpload = useSingleUpload();
  useLeaveWarning(dirty);

  const touch = () => {
    setDirty(true);
    setSavedOk(false);
    setProblem(null);
  };
  const selectedIndex = spots.findIndex((spot) => spot.id === selectedId);
  const selected = selectedIndex === -1 ? null : (spots[selectedIndex] as Spot);
  const patchSpot = (id: string, patch: Partial<Spot>) => {
    setSpots((current) => current.map((spot) => (spot.id === id ? { ...spot, ...patch } : spot)));
    touch();
  };
  const addSpot = (x = 50, y = 50) => {
    if (spots.length >= MAX_SPOTS) return;
    const spot = newSpot(x, y);
    setSpots((current) => current.concat(spot));
    setSelectedId(spot.id);
    touch();
  };
  const onSceneClick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = clamp(((event.clientX - box.left) / box.width) * 100, 0, 100);
    const y = clamp(((event.clientY - box.top) / box.height) * 100, 0, 100);
    if (selected) patchSpot(selected.id, { x, y });
    else addSpot(x, y);
  };

  const chooseScene = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (classifyFileName(file.name).kind !== 'photo' || file.size === 0) return sceneUpload.fail('Choose a picture (PNG or JPG).');
    const upload = await sceneUpload.send(file);
    if (upload) {
      setSceneFile({ file, uploadId: upload.id });
      touch();
    }
  };
  const chooseAudio = async (spot: Spot, files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (ACCEPT.audio.indexOf(classifyFileName(file.name).kind) === -1 || file.size === 0) return audioUpload.fail('Choose a sound file (for example .mp3 or a voice note).');
    const upload = await audioUpload.send(file);
    if (upload) patchSpot(spot.id, { audioUploadId: upload.id, audioName: upload.fileName });
  };
  const choosePackage = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (classifyFileName(file.name).kind !== 'animation' || file.size === 0) return packUpload.fail('Choose an animation package (.zip).');
    const upload = await packUpload.send(file);
    if (upload) {
      setPack({ uploadId: upload.id, packageUrl: null, checks: upload.checks, name: upload.fileName });
      touch();
    }
  };

  const hasScene = scene !== null || sceneFile !== null;
  const withoutAudio = spots.filter((spot) => !spot.audioUrl && !spot.audioUploadId);

  const save = useAction(async () => {
    const setup: TryItSetup =
      mode === 'package'
        ? { lessonId: lesson.id, mode: 'package', uploadId: pack.uploadId, packageUrl: pack.packageUrl, checks: pack.checks }
        : {
            lessonId: lesson.id,
            mode: 'hotspots',
            instruction: instruction.trim(),
            // TODO(stream-1): the contract answers validation on `scene`, so a newly uploaded
            // scene is sent as an upload id together with the old picture, if any (REQUESTS.md).
            scene,
            ...(sceneFile ? { sceneUploadId: sceneFile.uploadId } : {}),
            spots: spots.map(({ audioName: _audioName, ...spot }) => ({ ...spot, label: spot.label.trim(), role: spot.role.trim(), says: spot.says.trim() })),
            goal,
            finishMessage: finishMessage.trim(),
            gentleMovement: gentle,
          };
    await adminApi.saveTryItSetup(lesson.id, setup);
    setDirty(false);
    setSavedOk(true);
  });
  const trySave = () => {
    let found: string | null = null;
    if (mode === 'package') {
      if (!pack.uploadId && !pack.packageUrl) found = 'Choose the animation package first.';
      else if (pack.uploadId && !checksPass(pack.checks)) found = 'This package did not pass the checks. Ask EasySTEM for a version that works on the bag.';
    } else if (!hasScene) found = 'Add the scene picture first.';
    else if (spots.length === 0) found = 'Add at least one spot for learners to tap.';
    else {
      const bad = spots.findIndex((spot) => !spot.label.trim() || !spot.says.trim());
      if (bad !== -1) {
        found = `Spot ${bad + 1} needs a label and the words they say.`;
        setSelectedId((spots[bad] as Spot).id);
      }
    }
    setProblem(found);
    if (!found) void save.run();
  };

  return (
    <>
      <section className="adm-card adm-stack" aria-labelledby="adm-src-h">
        <h2 id="adm-src-h" className="adm-h2">
          1 · How do you want to make it?
        </h2>
        <div>
          <OptionRow
            name="adm-tryit-mode"
            value="package"
            checked={mode === 'package'}
            onChoose={() => {
              setMode('package');
              touch();
            }}
            label="Upload an animation package"
            detail="A .zip file with index.html inside, made in another tool."
          />
          <OptionRow
            name="adm-tryit-mode"
            value="hotspots"
            checked={mode === 'hotspots'}
            onChoose={() => {
              setMode('hotspots');
              touch();
            }}
            label="Build from a picture"
            detail="Upload a scene picture, then place spots that learners tap to hear a person speak."
          />
        </div>
      </section>

      {mode === 'package' ? (
        <section className="adm-card adm-stack" aria-labelledby="adm-pack-h">
          <h2 id="adm-pack-h" className="adm-h2">
            2 · Animation package
          </h2>
          <p className="adm-small" style={{ wordBreak: 'break-all' }}>
            {pack.name ? `New file: ${pack.name}` : pack.packageUrl ? 'A package is in place for this lesson.' : 'No package yet.'}
          </p>
          {packUpload.sending ? (
            <>
              <ProgressBar value={percent(packUpload.sent, packUpload.total)} label="Package upload" />
              <button type="button" className="adm-mini-btn" onClick={packUpload.stop}>
                Stop uploading
              </button>
            </>
          ) : (
            <FilePicker accept=".zip" onFiles={(files) => void choosePackage(files)} className="adm-mini-btn">
              <IconUpload size={22} />
              Choose .zip file
            </FilePicker>
          )}
          {packUpload.error ? (
            <p className="adm-inline-error" role="alert">
              {packUpload.error}
            </p>
          ) : null}
          <p className="adm-small">Must work offline: no links to the internet.</p>
          {pack.checks.length > 0 ? (
            <ul className="adm-list">
              {pack.checks.map((check) => (
                <li key={check.id} className={check.ok ? 'adm-note adm-note--ok' : 'adm-note adm-note--warn'}>
                  {check.ok ? <IconTick size={20} /> : <IconInfoMark size={20} />}
                  <span>
                    {check.title}. {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <>
          <section className="adm-card adm-stack" aria-labelledby="adm-pic-h">
            <h2 id="adm-pic-h" className="adm-h2">
              2 · Scene picture and spots
            </h2>
            <TextAreaField
              label="What learners are asked to do"
              rows={2}
              maxLength={200}
              value={instruction}
              onChange={(event) => {
                setInstruction(event.target.value);
                touch();
              }}
            />
            {sceneUpload.sending ? (
              <ProgressBar value={percent(sceneUpload.sent, sceneUpload.total)} label="Picture upload" />
            ) : (
              <FilePicker accept="image/png,image/jpeg" onFiles={(files) => void chooseScene(files)} className="adm-mini-btn">
                <IconUpload size={22} />
                {hasScene ? 'Replace picture' : 'Choose the scene picture'}
              </FilePicker>
            )}
            {sceneUpload.error ? (
              <p className="adm-inline-error" role="alert">
                {sceneUpload.error}
              </p>
            ) : null}
            {hasScene ? (
              <>
                <h3 className="adm-h3">Place the tappable spots</h3>
                <p className="adm-small">{selected ? `Tap the picture to move spot ${selectedIndex + 1} there, or use the buttons below.` : 'Tap the picture to add a spot. Make each spot cover the whole person.'}</p>
                <div className="adm-scene" onClick={onSceneClick}>
                  {sceneUrl ? <img src={sceneUrl} alt="The scene picture you chose" /> : scene ? <Illustration src={scene.url} alt={scene.alt} eager /> : null}
                  {spots.map((spot, index) => (
                    <span
                      key={spot.id}
                      className={spot.id === selectedId ? 'adm-scene__spot adm-scene__spot--selected' : 'adm-scene__spot'}
                      style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.r * 2}%`, height: 0, paddingTop: `${spot.r}%`, paddingBottom: `${spot.r}%` }}
                      aria-hidden="true"
                    >
                      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>{index + 1}</span>
                    </span>
                  ))}
                </div>
                <p className="adm-small">Learners never see the numbers or circles until they tap.</p>
                <div className="adm-cluster">
                  <button type="button" className="adm-mini-btn adm-mini-btn--solid" disabled={spots.length >= MAX_SPOTS} onClick={() => addSpot()}>
                    <IconPlus size={22} />
                    Add a spot
                  </button>
                  {spots.map((spot, index) => (
                    <button key={spot.id} type="button" className="adm-mini-btn" aria-pressed={spot.id === selectedId} onClick={() => setSelectedId(spot.id === selectedId ? null : spot.id)}>
                      Spot {index + 1}
                      {spot.id === selectedId ? ' · selected' : ''}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="adm-note">
                <IconInfoMark size={20} />
                <span>Add a picture first. Then you can place the spots.</span>
              </p>
            )}
          </section>

          {selected ? (
            <section className="adm-card adm-stack" aria-labelledby="adm-spot-h">
              <h2 id="adm-spot-h" className="adm-h2">
                Spot {selectedIndex + 1} of {spots.length}
              </h2>
              <div className="adm-nudge" role="group" aria-label={`Move or resize spot ${selectedIndex + 1}`}>
                <button type="button" className="adm-mini-btn" onClick={() => patchSpot(selected.id, { x: clamp(selected.x - STEP, 0, 100) })}>
                  <IconChevronLeft size={20} />
                  Left
                </button>
                <button type="button" className="adm-mini-btn" onClick={() => patchSpot(selected.id, { y: clamp(selected.y - STEP, 0, 100) })}>
                  <IconMoveUp size={20} />
                  Up
                </button>
                <button type="button" className="adm-mini-btn" onClick={() => patchSpot(selected.id, { x: clamp(selected.x + STEP, 0, 100) })}>
                  Right
                </button>
                <button type="button" className="adm-mini-btn" onClick={() => patchSpot(selected.id, { r: clamp(selected.r - 1, 3, 40) })}>
                  Smaller
                </button>
                <button type="button" className="adm-mini-btn" onClick={() => patchSpot(selected.id, { y: clamp(selected.y + STEP, 0, 100) })}>
                  <IconMoveDown size={20} />
                  Down
                </button>
                <button type="button" className="adm-mini-btn" onClick={() => patchSpot(selected.id, { r: clamp(selected.r + 1, 3, 40) })}>
                  Bigger
                </button>
              </div>
              <InputField label="Label (who it is)" value={selected.label} maxLength={80} onChange={(event) => patchSpot(selected.id, { label: event.target.value })} />
              <InputField label="Their role (optional)" hint="For example: Teacher, at the school." value={selected.role} maxLength={80} onChange={(event) => patchSpot(selected.id, { role: event.target.value })} />
              <TextAreaField label="What they say" rows={2} maxLength={300} value={selected.says} onChange={(event) => patchSpot(selected.id, { says: event.target.value })} />
              <div className="adm-stack--sm">
                <p className="adm-label">Audio clip</p>
                {selected.audioUploadId ? (
                  <p className="adm-note adm-note--ok">
                    <IconTick size={20} />
                    <span style={{ wordBreak: 'break-all' }}>New clip added: {selected.audioName}</span>
                  </p>
                ) : selected.audioUrl ? (
                  // The clip is only fetched if the admin presses play.
                  <audio controls preload="none" src={selected.audioUrl} style={{ width: '100%' }} />
                ) : (
                  <p className="adm-note">
                    <IconInfoMark size={20} />
                    <span>No audio yet. Learners will only read the words.</span>
                  </p>
                )}
                {audioUpload.sending ? (
                  <ProgressBar value={percent(audioUpload.sent, audioUpload.total)} label="Audio upload" />
                ) : (
                  <FilePicker accept="audio/*,.opus,.ogg,.amr" onFiles={(files) => void chooseAudio(selected, files)} className="adm-mini-btn">
                    <IconUpload size={22} />
                    {selected.audioUrl || selected.audioUploadId ? 'Replace audio' : 'Choose audio'}
                  </FilePicker>
                )}
                {audioUpload.error ? (
                  <p className="adm-inline-error" role="alert">
                    {audioUpload.error}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="adm-mini-btn adm-mini-btn--danger"
                onClick={() => {
                  setSpots((current) => current.filter((spot) => spot.id !== selected.id));
                  setSelectedId(null);
                  touch();
                }}
              >
                <IconTrash size={20} />
                Remove this spot
              </button>
            </section>
          ) : null}

          <section className="adm-card adm-stack" aria-labelledby="adm-set-h">
            <h2 id="adm-set-h" className="adm-h2">
              3 · Goal and finish
            </h2>
            <SelectField
              label="Goal"
              value={goal}
              hint={`Learners see “1 of ${Math.max(1, spots.length)} found” in words.`}
              onChange={(event) => {
                setGoal(event.target.value === 'any' ? 'any' : 'all');
                touch();
              }}
            >
              <option value="all">Find all {spots.length || ''}</option>
              <option value="any">Find any 1</option>
            </SelectField>
            <InputField
              label="Message when finished"
              value={finishMessage}
              maxLength={160}
              onChange={(event) => {
                setFinishMessage(event.target.value);
                touch();
              }}
            />
            <Switch
              label="Gentle movement"
              detail="Turns off by itself when the phone is set to reduce motion."
              checked={gentle}
              onChange={(value) => {
                setGentle(value);
                touch();
              }}
            />
            {spots.length > 0 && withoutAudio.length > 0 ? (
              <p className="adm-note adm-note--warn">
                <IconInfoMark size={20} />
                <span>
                  Almost ready. {withoutAudio.length === 1 ? `Spot ${spots.indexOf(withoutAudio[0] as Spot) + 1} has` : `${withoutAudio.length} spots have`} no audio yet. Learners will only read the words.
                </span>
              </p>
            ) : null}
          </section>
        </>
      )}

      {problem ? (
        <Message tone="error" title="Not ready to save">
          {problem}
        </Message>
      ) : null}
      {save.error ? (
        <Message tone="error" title="The setup was not saved">
          {save.error} Your changes are still on this page.
        </Message>
      ) : null}
      {savedOk ? (
        <Message tone="success" title="Saved in this bag">
          Learners see the change next time they open the lesson.
        </Message>
      ) : null}
      <div className="adm-cluster">
        {dirty ? (
          <Button working={save.working} workingLabel="Saving…" icon={<IconSave size={26} />} onClick={trySave}>
            Save
          </Button>
        ) : (
          <Button notReady icon={<IconSave size={26} />}>
            Nothing to save
          </Button>
        )}
        {lesson.status === 'published' ? (
          <Link to={paths.lesson(lesson.id)} className="adm-mini-btn">
            <IconEye size={22} />
            Test as learner
          </Link>
        ) : null}
      </div>
    </>
  );
}

export default function TryIt() {
  const { lessonId } = useParams<'lessonId'>();
  const loaded = useAdminApi(
    async (signal) => {
      const [lesson, setup] = await Promise.all([adminApi.getAdminLesson(lessonId, { signal }), adminApi.getTryItSetup(lessonId, { signal })]);
      return { lesson, setup };
    },
    [lessonId],
  );
  const data = loaded.data && loaded.data.lesson.id === lessonId ? loaded.data : null;
  const back = { to: adminPaths.library(data && data.lesson.placement ? { portalId: data.lesson.placement.portalId, groupId: data.lesson.placement.groupId, seriesId: data.lesson.placement.seriesId } : {}), label: 'Back to Library' };
  if (!data) {
    return (
      <AdminFrame title="Try it setup" nav="library" back={back}>
        {loaded.error ? (
          <ErrorState title={loaded.error.status === 409 ? 'This is not a Try it lesson' : 'The setup did not open'} error={loaded.error} onRetry={loaded.error.status === 409 ? undefined : loaded.reload} />
        ) : (
          <LoadingState label="Opening the setup…" />
        )}
      </AdminFrame>
    );
  }
  const { lesson, setup } = data;
  return (
    <AdminFrame title={`${lesson.title} · Try it setup`} nav="library" back={back}>
      <div className="adm-chips">
        <span className="adm-chip">
          <LessonTypeIcon type={lesson.type} size={18} />
          {LESSON_TYPES[lesson.type].label}
        </span>
        {lesson.position ? <span className="adm-chip">Lesson {lesson.position}</span> : null}
        <YouTakePart />
        <StatusChip status={lesson.status} placed={lesson.placement !== null} />
      </div>
      <PageHead title={`${lesson.title} · Try it setup`} lead="Learners tap and take part." />
      <SetupForm key={lesson.id} lesson={lesson} initial={setup} />
    </AdminFrame>
  );
}
