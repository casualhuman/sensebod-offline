/*
 * Full screen for the video picture. The standard API arrived in Chrome 71;
 * Chrome 58 on Android 8 and old Safari only have the webkit-prefixed one,
 * and iPhones can only put the <video> itself full screen. Where none of
 * these exist the button is not shown.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';

interface PrefixedDocument {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface PrefixedElement {
  webkitRequestFullscreen?: () => void;
}
interface PrefixedVideo {
  /** iPhone Safari: native full screen of the video element only. */
  webkitEnterFullscreen?: () => void;
}

function current(): Element | null {
  const doc = document as Document & PrefixedDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export interface Fullscreen {
  /** False where the browser offers no way at all: hide the button. */
  available: boolean;
  /** True while our stage fills the screen (our own controls stay visible). */
  active: boolean;
  enter: () => void;
  exit: () => void;
}

export function useFullscreen(stageRef: RefObject<HTMLElement>, videoRef: RefObject<HTMLVideoElement>): Fullscreen {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const stage = stageRef.current as (HTMLElement & PrefixedElement) | null;
    const video = videoRef.current as (HTMLVideoElement & PrefixedVideo) | null;
    setAvailable(!!stage && (typeof stage.requestFullscreen === 'function' || typeof stage.webkitRequestFullscreen === 'function' || (!!video && typeof video.webkitEnterFullscreen === 'function')));
    const onChange = () => setActive(!!stage && current() === stage);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      // Leaving the lesson while full screen: give the screen back.
      if (stage && current() === stage) leave();
    };
  }, [stageRef, videoRef]);

  const enter = useCallback(() => {
    const stage = stageRef.current as (HTMLElement & PrefixedElement) | null;
    const video = videoRef.current as (HTMLVideoElement & PrefixedVideo) | null;
    if (!stage) return;
    if (typeof stage.requestFullscreen === 'function') {
      const asked = stage.requestFullscreen();
      // Refused (for example by a browser setting): nothing to do, the page stays as it is.
      if (asked && typeof asked.catch === 'function') asked.catch(() => undefined);
    } else if (typeof stage.webkitRequestFullscreen === 'function') stage.webkitRequestFullscreen();
    else if (video && typeof video.webkitEnterFullscreen === 'function') video.webkitEnterFullscreen();
  }, [stageRef, videoRef]);

  return { available, active, enter, exit: leave };
}

function leave(): void {
  const doc = document as Document & PrefixedDocument;
  if (typeof document.exitFullscreen === 'function') {
    const asked = document.exitFullscreen();
    if (asked && typeof asked.catch === 'function') asked.catch(() => undefined);
  } else if (typeof doc.webkitExitFullscreen === 'function') doc.webkitExitFullscreen();
}
