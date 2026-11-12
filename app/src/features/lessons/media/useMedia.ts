/*
 * One hook behind the video and audio players (native <video> / <audio>, no
 * library). Rules it enforces:
 *   - nothing is requested until the learner taps Play: the element has no
 *     `src` before that, and `preload="none"` is set on the element as well
 *   - never plays by itself
 *   - the source is chosen with canPlayType; if a file fails to decode the
 *     next source is tried (the "smaller copy for old phones"); when nothing
 *     can be played the player shows a plain fallback instead of a dead box
 *   - on unmount playback stops and the source is detached, so the browser
 *     drops its buffers and the connection to the Pi
 *   - the page narration ("Listen") and the lesson never sound together
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MediaSource } from '@shared/api';
import { stopListening } from '@shared/shell';
// TODO(stream-1): `subscribeListen` and `getListenSnapshot` are not exported from
// '@shared/shell' (docs/team/REQUESTS.md). Needed to pause the lesson when
// the learner taps the gold Listen button.
import { getListenSnapshot, subscribeListen } from '@shared/shell/listen';
import { isLocalUrl } from './localUrl';
import { clampTime } from './time';

export type MediaStatus = 'ready' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/**
 * Why the media cannot play:
 *  - unsupported: this browser cannot decode any of the files
 *  - network: the file did not arrive (Wi-Fi dropped, Pi busy); trying again can help
 */
export type MediaProblem = 'unsupported' | 'network';

export interface MediaOptions {
  /** Called on every time change with the exact time (not rounded). */
  onTime?: (seconds: number) => void;
  /** Called when playback stops for any reason other than the end. */
  onPause?: (seconds: number) => void;
  onEnded?: () => void;
  /** Where to start the first time Play is tapped (saved progress). */
  startAt?: number | null;
}

export interface MediaController<E extends HTMLMediaElement> {
  ref: RefObject<E>;
  status: MediaStatus;
  problem: MediaProblem | null;
  /** True once Play has been tapped at least once. */
  started: boolean;
  /** Seconds, rounded down to half a second to keep re-renders low. */
  time: number;
  /** Seconds, or null until the browser knows it. */
  duration: number | null;
  muted: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setMuted: (muted: boolean) => void;
  /** After a problem: load the file again and carry on from the same place. */
  retry: () => void;
  /** Start again from the beginning ("Watch again"). */
  replay: () => void;
}

/** Index of the first source at or after `from` that this browser says it may play, or -1. */
export function pickSource(element: Pick<HTMLMediaElement, 'canPlayType'>, sources: readonly MediaSource[], from = 0): number {
  for (let index = from; index < sources.length; index += 1) {
    const source = sources[index];
    // Only files served by the bag itself are ever requested.
    if (!source || !isLocalUrl(source.url)) continue;
    // No type given: let the browser try. "" means "cannot play".
    if (!source.mimeType || element.canPlayType(source.mimeType) !== '') return index;
  }
  return -1;
}

const MEDIA_ERR_NETWORK = 2;

export function useMedia<E extends HTMLMediaElement>(sources: readonly MediaSource[], options: MediaOptions = {}): MediaController<E> {
  const ref = useRef<E>(null);
  const [status, setStatus] = useState<MediaStatus>('ready');
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [muted, setMutedState] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  /** Which source is loaded; -1 before the first Play. */
  const sourceIndex = useRef(-1);
  /** A time to jump to once the (re)loaded file knows its length. */
  const pendingSeek = useRef<number | null>(null);

  const fail = useCallback((why: MediaProblem) => {
    setProblem(why);
    setStatus('error');
  }, []);

  /** Attach source number `index` and start playing from `at`. */
  const load = useCallback(
    (element: E, index: number, at: number | null) => {
      const source = sourcesRef.current[index];
      if (!source) {
        fail('unsupported');
        return;
      }
      sourceIndex.current = index;
      pendingSeek.current = at !== null && at > 0 ? at : null;
      element.src = source.url;
      setProblem(null);
      setStatus('loading');
      const playing = element.play();
      // A rejected play() without an error event means the browser refused to
      // start (for example, the tap was not counted as a gesture): stay ready.
      if (playing && typeof playing.catch === 'function') {
        playing.catch(() => {
          if (!element.error) setStatus((current) => (current === 'loading' ? 'paused' : current));
        });
      }
    },
    [fail],
  );

  const play = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    stopListening();
    setStarted(true);
    if (sourceIndex.current === -1) {
      const index = pickSource(element, sourcesRef.current);
      if (index === -1) {
        fail('unsupported');
        return;
      }
      load(element, index, optionsRef.current.startAt ?? null);
      return;
    }
    if (element.ended) element.currentTime = 0;
    setStatus((current) => (current === 'playing' ? current : 'loading'));
    const playing = element.play();
    if (playing && typeof playing.catch === 'function') {
      playing.catch(() => {
        if (!element.error) setStatus((current) => (current === 'loading' ? 'paused' : current));
      });
    }
  }, [fail, load]);

  const pause = useCallback(() => {
    const element = ref.current;
    if (element) element.pause();
  }, []);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (sourceIndex.current === -1 || element.paused || element.ended) play();
    else element.pause();
  }, [play]);

  const seek = useCallback((seconds: number) => {
    const element = ref.current;
    if (!element || sourceIndex.current === -1) return;
    const length = isFinite(element.duration) && element.duration > 0 ? element.duration : null;
    const target = clampTime(seconds, length);
    if (length === null) {
      // Length not known yet (still loading): jump as soon as it is.
      pendingSeek.current = target;
    } else {
      element.currentTime = target;
    }
    setTime(Math.floor(target * 2) / 2);
    const onTime = optionsRef.current.onTime;
    if (onTime) onTime(target);
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const element = ref.current;
      if (element) seek(element.currentTime + delta);
    },
    [seek],
  );

  const setMuted = useCallback((next: boolean) => {
    const element = ref.current;
    if (element) element.muted = next;
    setMutedState(next);
  }, []);

  const retry = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    stopListening();
    const index = sourceIndex.current === -1 ? pickSource(element, sourcesRef.current) : sourceIndex.current;
    if (index === -1) {
      fail('unsupported');
      return;
    }
    load(element, index, element.currentTime || pendingSeek.current || null);
  }, [fail, load]);

  const replay = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (sourceIndex.current !== -1) element.currentTime = 0;
    setTime(0);
    play();
  }, [play]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const onPlaying = () => setStatus('playing');
    const onWaiting = () => {
      if (!element.paused) setStatus('loading');
    };
    const onPause = () => {
      if (element.ended) return;
      // An error also pauses the element; keep the error on screen.
      setStatus((current) => (current === 'error' ? current : 'paused'));
      const handler = optionsRef.current.onPause;
      if (handler) handler(element.currentTime);
    };
    const onEnded = () => {
      setStatus('ended');
      const handler = optionsRef.current.onEnded;
      if (handler) handler();
    };
    const onTimeUpdate = () => {
      const now = element.currentTime;
      const handler = optionsRef.current.onTime;
      if (handler) handler(now);
      // Half-second steps: at most two re-renders a second while playing.
      const rounded = Math.floor(now * 2) / 2;
      setTime((current) => (current === rounded ? current : rounded));
    };
    const onDuration = () => {
      if (isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    };
    const onMetadata = () => {
      onDuration();
      const target = pendingSeek.current;
      if (target !== null) {
        pendingSeek.current = null;
        element.currentTime = clampTime(target, isFinite(element.duration) ? element.duration : null);
      }
    };
    const onError = () => {
      if (sourceIndex.current === -1) return; // no source attached: nothing to report
      const code = element.error ? element.error.code : 0;
      if (code === MEDIA_ERR_NETWORK) {
        fail('network');
        return;
      }
      // Could not decode this file: try the next copy from the same place.
      const next = pickSource(element, sourcesRef.current, sourceIndex.current + 1);
      if (next === -1) fail('unsupported');
      else load(element, next, element.currentTime || null);
    };
    const onVolume = () => setMutedState(element.muted);

    const events: [string, () => void][] = [
      ['playing', onPlaying],
      ['waiting', onWaiting],
      ['pause', onPause],
      ['ended', onEnded],
      ['timeupdate', onTimeUpdate],
      ['durationchange', onDuration],
      ['loadedmetadata', onMetadata],
      ['error', onError],
      ['volumechange', onVolume],
    ];
    events.forEach(([name, handler]) => element.addEventListener(name, handler));

    // The gold Listen button started speaking: the lesson goes quiet.
    const unsubscribe = subscribeListen(() => {
      const speaking = getListenSnapshot().charAt(0) !== '|';
      if (speaking && !element.paused) element.pause();
    });

    return () => {
      unsubscribe();
      events.forEach(([name, handler]) => element.removeEventListener(name, handler));
      // Release: stop, detach the file and let the browser free its buffers.
      element.pause();
      if (sourceIndex.current !== -1) {
        element.removeAttribute('src');
        element.load();
      }
      sourceIndex.current = -1;
    };
  }, [fail, load]);

  return { ref, status, problem, started, time, duration, muted, play, pause, toggle, seek, skip, setMuted, retry, replay };
}
