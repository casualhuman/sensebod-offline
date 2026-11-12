/*
 * Who is signed in to the admin.
 *
 * The session itself is an HttpOnly cookie owned by the Pi: this code never
 * sees it, and nothing about it (no token, no password, no "is admin" flag)
 * is written to localStorage or sessionStorage. The state below lives in
 * memory only and is rebuilt from `GET /admin/session` after every page load.
 *
 * The guard is a convenience, not the protection: every /admin API call is
 * refused by the server without a valid session. Any 401 from any call ends
 * up in `sessionLost()`, which sends the person to the sign-in form and back
 * to the page they were on afterwards.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { adminApi, ApiError, useApi, type AdminSession, type ApiState } from '@shared/api';
import { ErrorState, LoadingState } from '@shared/components';
import { getLocation, navigate } from '@shared/router';
import { adminPaths } from './adminPaths';

export type SessionStatus = 'unknown' | 'checking' | 'in' | 'out' | 'error';

interface SessionState {
  status: SessionStatus;
  session: AdminSession | null;
  error: ApiError | null;
}

let state: SessionState = { status: 'unknown', session: null, error: null };
const listeners = new Set<() => void>();

function set(next: SessionState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = (): SessionState => state;

export function useAdminSession(): SessionState {
  return useSyncExternalStore(subscribe, getState);
}

/** Ask the bag who is signed in. Runs once per page load; "Try again" runs it again. */
export function checkSession(force = false): void {
  if (state.status === 'checking') return;
  if (!force && state.status !== 'unknown') return;
  set({ status: 'checking', session: null, error: null });
  adminApi.getSession().then(
    (session) => set({ status: 'in', session, error: null }),
    (error: unknown) => {
      const apiError = error instanceof ApiError ? error : new ApiError('network', 'Could not reach the bag.');
      if (apiError.status === 401 || apiError.status === 403) set({ status: 'out', session: null, error: null });
      else set({ status: 'error', session: null, error: apiError });
    },
  );
}

export function setSignedIn(session: AdminSession): void {
  set({ status: 'in', session, error: null });
}

/** The server said "not signed in" (expired session, signed out on another tab, bag restarted). */
export function sessionLost(): void {
  if (state.status !== 'out') set({ status: 'out', session: null, error: null });
}

/**
 * Call with every error from an admin API call. Returns true when the error
 * was "you are not signed in", in which case the guard is already taking the
 * person to the sign-in form and the screen should not show its own error.
 */
export function noteAdminError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) {
    sessionLost();
    return true;
  }
  return false;
}

/** `useApi` for admin data: the same hook, plus the central 401 handling. */
export function useAdminApi<T>(load: (signal: AbortSignal | undefined) => Promise<T>, deps: readonly unknown[]): ApiState<T> {
  const result = useApi(load, deps);
  const { error } = result;
  useEffect(() => {
    if (error) noteAdminError(error);
  }, [error]);
  return result;
}

/** Ends the session on the bag. Local state is cleared even if the bag cannot be reached. */
export function signOutAdmin(): Promise<void> {
  const done = () => set({ status: 'out', session: null, error: null });
  return adminApi.signOut().then(done, (error: unknown) => {
    // The cookie may still be valid on the bag. Say so instead of pretending.
    if (error instanceof ApiError && error.status === 401) {
      done();
      return;
    }
    throw error;
  });
}

export function resetAdminSessionForTests(): void {
  state = { status: 'unknown', session: null, error: null };
}

/** Wraps every admin screen except the sign-in form. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, error } = useAdminSession();

  useEffect(() => {
    if (status === 'unknown') checkSession();
  }, [status]);

  useEffect(() => {
    if (status !== 'out') return;
    const here = getLocation();
    navigate(adminPaths.signIn(here.pathname + here.search), { replace: true });
  }, [status]);

  if (status === 'in') return <>{children}</>;
  if (status === 'error') {
    return (
      <div className="adm-gate">
        <ErrorState title="The admin did not open" error={error} onRetry={() => checkSession(true)} />
      </div>
    );
  }
  return (
    <div className="adm-gate">
      <LoadingState label={status === 'out' ? 'Going to sign in…' : 'Opening the admin…'} />
    </div>
  );
}
