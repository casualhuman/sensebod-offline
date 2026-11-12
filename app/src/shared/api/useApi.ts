import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isAbort } from './client';

export interface ApiState<T> {
  /** The last successful answer; kept while a reload is running. */
  data: T | undefined;
  /** Set when the last attempt failed. Pass it to <ErrorState>. */
  error: ApiError | null;
  /** True during the first load and during reloads. */
  loading: boolean;
  /** "Try again": runs the request once more. */
  reload: () => void;
}

interface Stored<T> {
  /** The inputs this answer belongs to. */
  key: readonly unknown[];
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
}

function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Loads data for a screen and cancels the request when the screen goes away
 * or the inputs change, so a slow answer can never overwrite a newer one.
 *
 *   const { data, error, loading, reload } = useApi((signal) => getSeries(id, { signal }), [id]);
 *
 * The answer is tied to the inputs it was asked with: from the very first
 * render with new inputs the hook returns `data: undefined, loading: true`,
 * never the previous answer. "Try again" (`reload`) keeps the inputs, so it
 * keeps what is on screen while it runs.
 *
 * List everything the request reads in the dependency list, like useEffect
 * (lint checks it). Values are compared with Object.is, so pass strings and
 * numbers, not objects made during render.
 *
 * `signal` is undefined on browsers without AbortController (Chrome < 66);
 * the hook still ignores the stale answer there.
 */
export function useApi<T>(load: (signal: AbortSignal | undefined) => Promise<T>, deps: readonly unknown[]): ApiState<T> {
  const [state, setState] = useState<Stored<T>>({ key: deps, data: undefined, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  // Always call the newest `load` (it closes over the newest props).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let current = true;
    const key = deps;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    setState((previous) => {
      // Same inputs ("Try again"): keep what is on screen while asking again.
      const keep = sameInputs(previous.key, key);
      if (keep && previous.loading && !previous.error) return previous;
      return { key, data: keep ? previous.data : undefined, error: null, loading: true };
    });
    loadRef.current(controller ? controller.signal : undefined).then(
      (data) => {
        if (current) setState({ key, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (!current || isAbort(error)) return;
        const apiError = error instanceof ApiError ? error : new ApiError('network', 'Could not reach the bag.');
        setState((previous) => ({ key, data: sameInputs(previous.key, key) ? previous.data : undefined, error: apiError, loading: false }));
      },
    );
    return () => {
      current = false;
      if (controller) controller.abort();
    };
    // The caller lists what the request depends on, exactly like useEffect;
    // lint checks the caller's list (additionalHooks in eslint.config.js).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // Freshness is decided here, during render, not in the effect: an answer
  // that belongs to other inputs is never handed to the screen.
  const fresh = sameInputs(state.key, deps);
  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : null,
    loading: fresh ? state.loading : true,
    reload,
  };
}
