/*
 * Save my progress (board: V3-SignIn). Optional: a name and who you are.
 * No password, no phone number. A shared phone offers the names used on it
 * before; "Remove a name" deletes that learner and their progress from the bag.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, learnerApi, newRequestKey, type Learner, type LearnerRole } from '@shared/api';
import { Badge, Button, ButtonLink, Card, ChoiceGroup, ChoiceLink, ErrorState, InfoStrip, Message, TextField } from '@shared/components';
import { IconClose, IconHome, IconLock, IconPencil, IconPerson, IconPortalPrimary, IconSave, IconSkip, IconTrash } from '@shared/icons';
import { navigate, useQuery } from '@shared/router';
import { forgetLearner, learnAsGuest, setLearner, useSession } from '@shared/session';
import { ListenBar, PageShell } from '@shared/shell';
import { IconTeacher } from '../icons';
import { returnToFromQuery, setLearnerNotice } from '../lib';

const NAME_MAX = 40;

const ROLE_OPTIONS = [
  { value: 'learner', label: 'Learner', mark: <IconPortalPrimary size={28} /> },
  { value: 'teacher', label: 'Teacher', mark: <IconTeacher size={28} /> },
  { value: 'other', label: 'Parent, farmer or other', mark: <IconHome size={28} /> },
] as const;

function KnownNames({ learners, returnTo }: { learners: readonly Learner[]; returnTo: string }) {
  const [removing, setRemoving] = useState(false);
  const [target, setTarget] = useState<Learner | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const remove = (learner: Learner) => {
    setWorking(true);
    setError(null);
    learnerApi.deleteLearner(learner.id).then(
      () => true,
      // Already gone from the bag: only this phone still remembered the name.
      (reason: unknown) => (reason instanceof ApiError && reason.status === 404 ? true : Promise.reject(reason)),
    ).then(
      () => {
        forgetLearner(learner.id);
        if (!mounted.current) return;
        setWorking(false);
        setTarget(null);
        setRemoving(false);
      },
      (reason: unknown) => {
        if (!mounted.current) return;
        setWorking(false);
        setError(reason);
      },
    );
  };

  return (
    <Card tappable large className="lrn-panel" aria-labelledby="lrn-returning">
      <div className="lrn-media">
        <Badge size="md" className="lrn-media__badge lrn-badge--tint-ring">
          <IconPerson size={32} />
        </Badge>
        <div>
          <h2 id="lrn-returning" className="sb-h3">
            Used this phone before?
          </h2>
          <p className="sb-body sb-muted">{removing ? 'Tap the name to remove.' : 'Tap your name.'}</p>
        </div>
      </div>

      {target ? (
        <Message tone="error" title={`Remove ${target.name}?`} className="lrn-gap-top">
          <p>Their saved progress in this bag will be removed too. This cannot be undone.</p>
          {error ? <p className="lrn-gap-top">{error instanceof ApiError ? error.message : 'It did not work. Please try again.'}</p> : null}
          <Button variant="danger" fullWidth icon={<IconTrash size={28} />} working={working} workingLabel="Removing…" className="lrn-gap-top" onClick={() => remove(target)}>
            Yes, remove {target.name}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            disabled={working}
            className="lrn-gap-top"
            onClick={() => {
              setTarget(null);
              setError(null);
            }}
          >
            No, keep it
          </Button>
        </Message>
      ) : (
        <div className="sb-choices lrn-gap-top">
          {learners.map((learner) =>
            removing ? (
              <Button key={learner.id} variant="danger-outline" fullWidth icon={<IconTrash size={28} />} onClick={() => setTarget(learner)}>
                Remove {learner.name}
              </Button>
            ) : (
              <ChoiceLink
                key={learner.id}
                to={returnTo}
                label={learner.name}
                detail={learner.roleLabel}
                mark={learner.name.charAt(0).toUpperCase()}
                onClick={() => setLearner(learner)}
              />
            ),
          )}
        </div>
      )}

      {target ? null : (
        <button type="button" className="lrn-text-button lrn-text-button--danger lrn-gap-top" aria-pressed={removing} onClick={() => setRemoving(!removing)}>
          {removing ? <IconClose size={26} /> : <IconTrash size={26} />}
          {removing ? 'Stop removing' : 'Remove a name'}
        </button>
      )}
    </Card>
  );
}

function NewNameForm({ returnTo }: { returnTo: string }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<LearnerRole>('learner');
  const [working, setWorking] = useState(false);
  const [nameProblem, setNameProblem] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  // One key per thing being saved: a second tap, or "try again" after the
  // Wi-Fi dropped, can never create the same learner twice.
  const requestKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (controller.current) controller.current.abort();
    };
  }, []);

  const trimmed = name.trim();

  const save = (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (working) return;
    if (!trimmed) {
      setNameProblem('Type your name first.');
      return;
    }
    setWorking(true);
    setError(null);
    setNameProblem(undefined);
    if (!requestKey.current) requestKey.current = newRequestKey();
    controller.current = typeof AbortController === 'undefined' ? null : new AbortController();
    learnerApi
      .createLearner({ name: trimmed, role }, { idempotencyKey: requestKey.current, signal: controller.current ? controller.current.signal : undefined })
      .then(
        (learner) => {
          if (!mounted.current) return;
          setLearner(learner);
          setLearnerNotice({ kind: 'saved', name: learner.name });
          navigate(returnTo, { replace: true });
        },
        (reason: unknown) => {
          if (!mounted.current) return;
          setWorking(false);
          if (reason instanceof ApiError && reason.fields.name) setNameProblem(reason.fields.name);
          else setError(reason);
        },
      );
  };

  const changed = () => {
    requestKey.current = null;
    setError(null);
  };

  return (
    <Card tappable large className="lrn-panel">
      <form onSubmit={save} noValidate aria-label="Add a new name">
        <TextField
          label="Your name"
          placeholder="Type your name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="given-name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          error={nameProblem}
          onChange={(event) => {
            setName(event.target.value);
            setNameProblem(undefined);
            changed();
          }}
        />
        <p className="lrn-field-label" aria-hidden="true">
          Who are you?
        </p>
        <ChoiceGroup
          label="Who are you?"
          options={ROLE_OPTIONS}
          value={role}
          compact
          disabled={working}
          onChange={(value) => {
            setRole(value);
            changed();
          }}
        />
        {error ? <ErrorState title="Your name was not saved" error={error} className="lrn-gap-top-lg" /> : null}
        {trimmed ? (
          <Button type="submit" size="lg" fullWidth icon={<IconSave size={28} />} working={working} workingLabel="Saving your name…" className="lrn-gap-top-lg">
            {error ? 'Try again' : 'Save and start learning'}
          </Button>
        ) : (
          <Button type="submit" size="lg" fullWidth notReady icon={<IconPencil size={28} />} className="lrn-gap-top-lg">
            Type your name first
          </Button>
        )}
      </form>
      <ButtonLink to={returnTo} variant="secondary" fullWidth icon={<IconSkip size={30} />} className="lrn-gap-top" onClick={learnAsGuest}>
        Skip — learn as a guest
      </ButtonLink>
      <InfoStrip icon={<IconLock size={32} />} className="lrn-gap-top-lg">
        No password. No phone number. Your name stays in this bag.
      </InfoStrip>
    </Card>
  );
}

export default function SaveProgress() {
  const { knownLearners } = useSession();
  const returnTo = returnToFromQuery(useQuery());
  const hasNames = knownLearners.length > 0;

  return (
    <PageShell title="Save my progress" backTo={returnTo} listenSrc={null}>
      <div className="sb-stack sb-stack--lg">
        <section className="lrn-intro">
          <h1 className="sb-h1">Save my progress</h1>
          <p className="sb-body sb-muted">Add your name so this bag remembers what you learned.</p>
          <ListenBar src={null} className="lrn-listen lrn-gap-top" />
        </section>

        <div className={hasNames ? 'lrn-two-col' : 'lrn-narrow'}>
          {hasNames ? <KnownNames learners={knownLearners} returnTo={returnTo} /> : null}
          <section aria-labelledby="lrn-new-name" className="sb-stack">
            <h2 id="lrn-new-name" className="sb-h3 lrn-section-title">
              {hasNames ? 'Or add a new name' : 'Add your name'}
            </h2>
            <NewNameForm returnTo={returnTo} />
          </section>
        </div>
      </div>
    </PageShell>
  );
}
