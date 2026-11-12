/* Small hooks shared by the admin screens. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { describeError, isAbort } from '@shared/api';
import { noteAdminError } from '../session';
import { UploadQueue, type QueueItem, type UploadQueueOptions } from './uploadQueue';

export interface ActionState<A extends unknown[]> {
  /**
   * Runs the action. While one run is in flight every further call is
   * ignored (resolves false), so a double tap or an impatient second press
   * cannot submit twice. Resolves true when the action succeeded.
   */
  run: (...args: A) => Promise<boolean>;
  working: boolean;
  /** Plain sentence when the last run failed. */
  error: string | null;
  /** The caught error of the last run, for field problems (`ApiError.fields`). */
  cause: unknown;
  clearError: () => void;
}

/**
 * One user action that talks to the bag (save, publish, delete). The lock is
 * a ref, not state: two taps inside the same frame are both stopped, which a
 * `disabled` attribute set by a re-render cannot guarantee.
 */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>): ActionState<A> {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<{ message: string; cause: unknown } | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args: A): Promise<boolean> => {
    if (locked.current) return false;
    locked.current = true;
    setWorking(true);
    setFailure(null);
    try {
      await actionRef.current(...args);
      return true;
    } catch (error) {
      if (!isAbort(error) && !noteAdminError(error) && mounted.current) setFailure({ message: describeError(error), cause: error });
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setWorking(false);
    }
  }, []);

  const clearError = useCallback(() => setFailure(null), []);
  return { run, working, error: failure ? failure.message : null, cause: failure ? failure.cause : null, clearError };
}

/**
 * Asks the browser to confirm before the page is closed or refreshed while
 * work would be lost (chosen files not yet on the bag, an upload in flight).
 * In-app links are not affected: screens handle those themselves.
 */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome before 119 and every old WebView need returnValue to be set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

const LAPTOP_QUERY = '(min-width: 1100px)';

function subscribeToWidth(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(LAPTOP_QUERY);
  // MediaQueryList only became an EventTarget in Chrome 45 / Safari 14; addListener works everywhere.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
}

function isLaptopNow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(LAPTOP_QUERY).matches;
}

/**
 * True from 1100px (the shared laptop breakpoint). Used where the laptop
 * board has a different structure from the phone board (side menu instead of
 * tabs, selects instead of big choice rows), not for spacing: that is CSS.
 */
export function useIsLaptop(): boolean {
  return useSyncExternalStore(subscribeToWidth, isLaptopNow, () => false);
}

/**
 * An UploadQueue for the life of a screen. The upload in flight is cancelled
 * when the screen goes away; files that already finished stay on the bag.
 */
export function useUploadQueue(makeOptions: () => UploadQueueOptions): { queue: UploadQueue; items: readonly QueueItem[]; running: boolean } {
  const ref = useRef<UploadQueue | null>(null);
  if (ref.current === null) ref.current = new UploadQueue(makeOptions());
  const queue = ref.current;
  const items = useSyncExternalStore(queue.subscribe, queue.getItems);
  useEffect(() => () => queue.dispose(), [queue]);
  return { queue, items, running: queue.isRunning };
}

/** Object URLs for local previews (photos, a scene picture). Revoked when the blob changes or the screen goes away. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return undefined;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return url;
}
