/*
 * Admin sign-in (ADM-SignIn).
 *
 * The password goes to the bag once, in the body of `POST /admin/session`,
 * and is then dropped: it is never written to storage, never put in a URL
 * and never kept after a successful sign-in. The session is the bag's
 * HttpOnly cookie. Throttling of wrong passwords is the server's job
 * (API-CONTRACT section 9, point 3).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { adminApi, ApiError, describeError } from '@shared/api';
import { Button, LoadingState, Message } from '@shared/components';
import { IconArrowRight, IconLock } from '@shared/icons';
import { Link, navigate, paths, useQuery } from '@shared/router';
import { adminPaths, safeNextPath } from '../adminPaths';
import { InputField } from '../components';
import { IconBagWifi, IconEye } from '../icons';
import { checkSession, setSignedIn, useAdminSession } from '../session';
import '../admin.css';
import './signin.css';

const USERNAME_MAX = 64;
const PASSWORD_MAX = 256;

function afterSignIn(next: string | null): string {
  if (next) return next;
  // A laptop starts in the Library (ADM-SignIn leads to ADM-Library); a phone starts at Home (ADM-M-Home).
  const wide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1100px)').matches;
  return wide ? adminPaths.library() : adminPaths.home();
}

export default function SignIn() {
  const next = safeNextPath(useQuery().get('next'));
  const { status } = useAdminSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<{ username?: string; password?: string; form?: string }>({});
  const locked = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    document.title = 'Admin sign-in · Sensebod Offline';
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Someone who is already signed in does not need the form.
  useEffect(() => {
    if (status === 'unknown') checkSession();
    if (status === 'in') navigate(afterSignIn(next), { replace: true });
  }, [status, next]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked.current) return;
    const name = username.trim();
    const found: typeof problem = {};
    if (!name) found.username = 'Type your username.';
    else if (name.length > USERNAME_MAX) found.username = 'That username is too long.';
    if (!password) found.password = 'Type your password.';
    else if (password.length > PASSWORD_MAX) found.password = 'That password is too long.';
    setProblem(found);
    if (found.username || found.password) return;

    locked.current = true;
    setWorking(true);
    adminApi.signIn({ username: name, password }).then(
      (session) => {
        locked.current = false;
        setPassword('');
        setSignedIn(session);
        navigate(afterSignIn(next), { replace: true });
      },
      (error: unknown) => {
        locked.current = false;
        if (!mounted.current) return;
        setWorking(false);
        const wrong = error instanceof ApiError && error.status === 401;
        setProblem({ form: wrong ? 'That username or password is not right. Check them and try again.' : describeError(error) });
      },
    );
  };

  if (status === 'in') return <LoadingState label="Opening the admin…" className="adm-gate" />;

  return (
    <div className="adm-signin">
      <main className="adm-signin__card" id="adm-main">
        <span className="adm-brand adm-brand--signin">
          <img className="adm-signin__logo" src="/brand/sensebod-logo.png" alt="Sensebod" width="150" height="45" />
          <span className="adm-brand__tag">Offline</span>
        </span>
        <h1 className="adm-h1">Admin</h1>
        <p className="adm-lead">For EasySTEM staff and facilitators</p>

        <form className="adm-signin__form adm-stack" onSubmit={submit} noValidate>
          {problem.form ? (
            <Message tone="error" title="You are not signed in">
              {problem.form}
            </Message>
          ) : null}
          <InputField
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={USERNAME_MAX}
            value={username}
            error={problem.username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <div className="adm-signin__password">
            <InputField
              label="Password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={PASSWORD_MAX}
              value={password}
              error={problem.password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="button" className="adm-mini-btn adm-signin__show" aria-pressed={show} onClick={() => setShow((value) => !value)}>
              <IconEye size={22} />
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <Button type="submit" size="lg" fullWidth working={working} workingLabel="Signing in…" iconAfter={<IconArrowRight size={28} />}>
            Sign in
          </Button>
        </form>

        <div className="adm-signin__notes adm-stack">
          <p className="adm-note">
            <Link to={paths.home()}>Go to the learning site</Link>
          </p>
          <p className="adm-note">
            <IconLock size={22} />
            <span>Forgot the password? Ask your EasySTEM contact how to reset it.</span>
          </p>
          <p className="adm-note adm-note--ok">
            <IconBagWifi size={22} />
            <span>Running on this bag</span>
          </p>
        </div>
      </main>
    </div>
  );
}
