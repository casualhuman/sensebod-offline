/*
 * Sign in / Save my progress (board: V3-SignIn; owner decision 2026-11-16).
 *
 * Signing in is optional: every lesson is open to a guest. A learner is a
 * name, who they are, and a 4-digit secret number of their own choosing. The
 * number tells two learners with the same name apart and lets a learner come
 * back on another phone. No phone number, no email.
 *
 *   signed in  who is signed in · Sign out · Keep learning (nothing else)
 *   start      "I am new here" · "I have a name already" · names used on this
 *              phone · learn as a guest
 *   new        one question per step: name, who you are, secret number
 *   back       name + secret number
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, learnerApi, newRequestKey, type Learner, type LearnerRole } from '@shared/api';
import { Badge, Button, ButtonLink, Card, ErrorState, Message, TextField } from '@shared/components';
import { IconArrowRight, IconBack, IconClose, IconHome, IconLeave, IconPerson, IconPersonAdd, IconPortalPrimary, IconSave, IconSkip, IconTrash } from '@shared/icons';
import { Link, navigate, useQuery } from '@shared/router';
import { forgetLearner, learnAsGuest, setLearner, useSession } from '@shared/session';
import { PageShell } from '@shared/shell';
import { IconTeacher } from '../icons';
import { firstName, returnToFromQuery, setLearnerNotice } from '../lib';

const NAME_MAX = 40;
const PIN_HINT = '4 numbers, for example 2 5 8 0';

const ROLE_OPTIONS = [
  { value: 'learner', label: 'Learner', mark: <IconPortalPrimary size={28} /> },
  { value: 'teacher', label: 'Teacher', mark: <IconTeacher size={28} /> },
  { value: 'other', label: 'Parent, farmer or other', mark: <IconHome size={28} /> },
] as const;

/** Digits only, at most four: whatever the keyboard sends. */
function cleanPin(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 4);
}

const pinField = {
  inputMode: 'numeric',
  pattern: '[0-9]*',
  maxLength: 4,
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  placeholder: '• • • •',
} as const;

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function BackLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="lrn-text-button" onClick={onClick}>
      <IconBack size={26} />
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Names used on this phone before                                     */
/* ------------------------------------------------------------------ */

function KnownNames({ learners, onPick }: { learners: readonly Learner[]; onPick: (learner: Learner) => void }) {
  const [removing, setRemoving] = useState(false);
  const [target, setTarget] = useState<Learner | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useMounted();

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
              <Button key={learner.id} variant="secondary" fullWidth icon={<IconPerson size={28} />} onClick={() => onPick(learner)}>
                {learner.name}
              </Button>
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

/* ------------------------------------------------------------------ */
/* "I have a name already": name + secret number                       */
/* ------------------------------------------------------------------ */

function SignInForm({ returnTo, startName, onBack }: { returnTo: string; startName: string; onBack: () => void }) {
  const [name, setName] = useState(startName);
  const [pin, setPin] = useState('');
  const [working, setWorking] = useState(false);
  const [nameProblem, setNameProblem] = useState<string | undefined>(undefined);
  const [pinProblem, setPinProblem] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const mounted = useMounted();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    const trimmed = name.trim();
    setNameProblem(trimmed ? undefined : 'Type your name first.');
    setPinProblem(pin.length === 4 ? undefined : 'Type your 4 numbers.');
    if (!trimmed || pin.length !== 4) return;
    setWorking(true);
    setError(null);
    setRefused(null);
    learnerApi.signInLearner({ name: trimmed, pin }).then(
      (learner) => {
        if (!mounted.current) return;
        setLearner(learner);
        setLearnerNotice({ kind: 'welcome', name: learner.name });
        navigate(returnTo, { replace: true });
      },
      (reason: unknown) => {
        if (!mounted.current) return;
        setWorking(false);
        setPin('');
        if (reason instanceof ApiError && reason.fields.name) setNameProblem(reason.fields.name);
        else if (reason instanceof ApiError && reason.fields.pin) setPinProblem(reason.fields.pin);
        // The bag's own words for a wrong name or number, and for too many tries.
        else if (reason instanceof ApiError && (reason.status === 401 || reason.status === 429) && reason.message) setRefused(reason.message);
        else setError(reason);
      },
    );
  };

  return (
    <section aria-labelledby="lrn-back" className="sb-stack">
      <h1 id="lrn-back" className="sb-h1">
        Welcome back
      </h1>
      <p className="sb-body sb-muted">Type your name and your secret number.</p>
      {refused ? <Message tone="error" title={refused} /> : null}
      {error ? <ErrorState title="You are not signed in" error={error} /> : null}
      <form onSubmit={submit} noValidate aria-label="Sign in" className="sb-stack">
        <TextField
          label="Your name"
          placeholder="Type your name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          error={nameProblem}
          onChange={(event) => {
            setName(event.target.value);
            setNameProblem(undefined);
          }}
        />
        <TextField
          label="Your secret number"
          hint={PIN_HINT}
          value={pin}
          {...pinField}
          error={pinProblem}
          onChange={(event) => {
            setPin(cleanPin(event.target.value));
            setPinProblem(undefined);
          }}
        />
        <Button type="submit" size="lg" fullWidth icon={<IconArrowRight size={28} />} working={working} workingLabel="Signing in…">
          Sign in
        </Button>
      </form>
      <BackLink onClick={onBack}>Go back</BackLink>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* "I am new here": name, who you are, secret number                   */
/* ------------------------------------------------------------------ */

function NewLearnerFlow({ returnTo, onBack }: { returnTo: string; onBack: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [role, setRole] = useState<LearnerRole>('learner');
  const [pin, setPin] = useState('');
  const [working, setWorking] = useState(false);
  const [nameProblem, setNameProblem] = useState<string | undefined>(undefined);
  const [pinProblem, setPinProblem] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  // One key per thing being saved: a second tap, or "try again" after the
  // Wi-Fi dropped, can never create the same learner twice.
  const requestKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useMounted();
  useEffect(
    () => () => {
      if (controller.current) controller.current.abort();
    },
    [],
  );

  const trimmed = name.trim();

  const nameDone = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) {
      setNameProblem('Type your name first.');
      return;
    }
    setNameProblem(undefined);
    setStep(2);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    if (pin.length !== 4) {
      setPinProblem('Type 4 numbers.');
      return;
    }
    setWorking(true);
    setError(null);
    setPinProblem(undefined);
    if (!requestKey.current) requestKey.current = newRequestKey();
    controller.current = typeof AbortController === 'undefined' ? null : new AbortController();
    learnerApi
      .createLearner({ name: trimmed, role, pin }, { idempotencyKey: requestKey.current, signal: controller.current ? controller.current.signal : undefined })
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
          if (reason instanceof ApiError && reason.fields.name) {
            // The bag did not accept the name: back to the name, with its words.
            requestKey.current = null;
            setNameProblem(reason.fields.name);
            setStep(1);
          } else if (reason instanceof ApiError && reason.fields.pin) {
            requestKey.current = null;
            setPinProblem(reason.fields.pin);
          } else setError(reason);
        },
      );
  };

  if (step === 1) {
    return (
      <section aria-labelledby="lrn-name" className="sb-stack">
        <h1 id="lrn-name" className="sb-h1">
          What is your name?
        </h1>
        <form onSubmit={nameDone} noValidate aria-label="Step 1 of 3" className="sb-stack">
          <TextField
            label="Your name"
            placeholder="Type your name"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="given-name"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            error={nameProblem}
            onChange={(event) => {
              setName(event.target.value);
              setNameProblem(undefined);
              requestKey.current = null;
            }}
          />
          <Button type="submit" size="lg" fullWidth icon={<IconArrowRight size={28} />}>
            Next
          </Button>
        </form>
        <BackLink onClick={onBack}>Go back</BackLink>
      </section>
    );
  }

  if (step === 2) {
    return (
      <section aria-labelledby="lrn-who" className="sb-stack">
        <h1 id="lrn-who" className="sb-h1">
          Hello, {firstName(trimmed)}! Who are you?
        </h1>
        <p className="sb-body sb-muted">Tap one.</p>
        <div className="sb-choices">
          {ROLE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant="secondary"
              size="lg"
              fullWidth
              icon={option.mark}
              onClick={() => {
                setRole(option.value);
                requestKey.current = null;
                setStep(3);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <BackLink onClick={() => setStep(1)}>Change my name</BackLink>
      </section>
    );
  }

  return (
    <section aria-labelledby="lrn-pin" className="sb-stack">
      <h1 id="lrn-pin" className="sb-h1">
        Choose a secret number
      </h1>
      <p className="sb-body sb-muted">4 numbers that only you know. You will need them to sign in again, so remember them.</p>
      {error ? <ErrorState title="Your name was not saved" error={error} /> : null}
      <form onSubmit={save} noValidate aria-label="Step 3 of 3" className="sb-stack">
        <TextField
          label="Your secret number"
          hint={PIN_HINT}
          value={pin}
          {...pinField}
          enterKeyHint="done"
          error={pinProblem}
          onChange={(event) => {
            setPin(cleanPin(event.target.value));
            setPinProblem(undefined);
            requestKey.current = null;
          }}
        />
        <Button type="submit" size="lg" fullWidth icon={<IconSave size={28} />} working={working} workingLabel="Saving your name…">
          {error ? 'Try again' : 'Save and start learning'}
        </Button>
      </form>
      <BackLink onClick={() => setStep(2)}>Go back</BackLink>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

export default function SaveProgress() {
  const { learner, knownLearners } = useSession();
  const returnTo = returnToFromQuery(useQuery());
  const [mode, setMode] = useState<'start' | 'new' | 'back'>('start');
  const [startName, setStartName] = useState('');
  const signOut = () => {
    learnAsGuest();
    setMode('start');
  };

  let body;
  if (learner) {
    // Somebody is signed in: this screen is only about them. The ways to sign in come back after Sign out.
    body = (
      <section aria-labelledby="lrn-account" className="sb-stack">
        <h1 id="lrn-account" className="sb-h1">
          You are signed in
        </h1>
        <Card tappable large className="lrn-panel">
          <div className="lrn-media">
            <Badge size="md" className="lrn-media__badge lrn-badge--tint-ring">
              <IconPerson size={32} />
            </Badge>
            <div>
              <p className="lrn-media__title">{learner.name}</p>
              <p className="sb-label lrn-regular sb-muted">{learner.roleLabel}</p>
            </div>
          </div>
          <Button variant="secondary" fullWidth icon={<IconLeave size={28} />} className="lrn-gap-top" onClick={signOut}>
            Sign out
          </Button>
        </Card>
        <p className="sb-body sb-muted">Sign out when you finish, so the next person can sign in on this phone.</p>
        <ButtonLink to={returnTo} size="lg" fullWidth icon={<IconArrowRight size={28} />}>
          Keep learning
        </ButtonLink>
      </section>
    );
  } else if (mode === 'new') body = <NewLearnerFlow returnTo={returnTo} onBack={() => setMode('start')} />;
  else if (mode === 'back') body = <SignInForm returnTo={returnTo} startName={startName} onBack={() => setMode('start')} />;
  else {
    body = (
      <>
        <section aria-labelledby="lrn-signin" className="sb-stack">
          <h1 id="lrn-signin" className="sb-h1">
            Sign in
          </h1>
          <p className="sb-body sb-muted">Sign in so this bag remembers what you learned.</p>
          <Button size="lg" fullWidth icon={<IconPersonAdd size={28} />} onClick={() => setMode('new')}>
            I am new here
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            icon={<IconPerson size={28} />}
            onClick={() => {
              setStartName('');
              setMode('back');
            }}
          >
            I have a name already
          </Button>
        </section>

        {knownLearners.length > 0 ? (
          <KnownNames
            learners={knownLearners}
            onPick={(picked) => {
              setStartName(picked.name);
              setMode('back');
            }}
          />
        ) : null}

        <Link to={returnTo} className="lrn-text-button" onClick={learnAsGuest}>
          <IconSkip size={26} />
          Not now, learn as a guest
        </Link>
      </>
    );
  }

  return (
    <PageShell title="Sign in" backTo={returnTo} listenSrc={null}>
      <div className="sb-stack sb-stack--lg lrn-narrow">{body}</div>
    </PageShell>
  );
}
