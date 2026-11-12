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

/**
 * Loads data for a screen and cancels the request when the screen goes away
 * or the inputs change, so a slow answer can never overwrite a newer one.
 *
 *   const { data, error, loading, reload } = useApi((signal) => getSeries(id, { signal }), [id]);
 *
 * `signal` is undefined on browsers without AbortController (Chrome < 66);
 * the hook still ignores the stale answer there.
 */
export function useApi<T>(load: (signal: AbortSignal | undefined) => Promise<T>, deps: readonly unknown[]): ApiState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: ApiError | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastAttempt = useRef(0);

  useEffect(() => {
    let current = true;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    // "Try again" keeps what is on screen; new inputs must not show the old answer.
    const isReload = lastAttempt.current !== attempt;
    lastAttempt.current = attempt;
    setState((previous) => {
      const data = isReload ? previous.data : undefined;
      if (previous.loading && !previous.error && previous.data === data) return previous;
      return { data, error: null, loading: true };
    });
    loadRef.current(controller ? controller.signal : undefined).then(
      (data) => {
        if (current) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (!current || isAbort(error)) return;
        const apiError = error instanceof ApiError ? error : new ApiError('network', 'Could not reach the bag.');
        setState((previous) => ({ data: previous.data, error: apiError, loading: false }));
      },
    );
    return () => {
      current = false;
      if (controller) controller.abort();
    };
    // The caller lists what the request depends on, exactly like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
