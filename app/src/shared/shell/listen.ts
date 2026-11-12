/*
 * One shared audio element for page narration ("Listen"). Only one thing
 * speaks at a time, nothing is fetched until the learner taps (no preload,
 * no autoplay), and the element is released when playback stops.
 */
type Listener = () => void;

let audio: HTMLAudioElement | null = null;
let currentSrc: string | null = null;
let failedSrc: string | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeListen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The narration URL that is playing now, or null. */
export function getListenSnapshot(): string {
  return (currentSrc ?? '') + '|' + (failedSrc ?? '');
}

export function isListening(src: string | null | undefined): boolean {
  return !!src && currentSrc === src;
}

export function listenFailed(src: string | null | undefined): boolean {
  return !!src && failedSrc === src;
}

export function stopListening(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load(); // lets the browser drop the buffered media
  }
  if (currentSrc !== null) {
    currentSrc = null;
    emit();
  }
}

export function startListening(src: string): void {
  stopListening();
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('ended', () => stopListening());
    audio.addEventListener('error', () => {
      if (currentSrc === null) return;
      failedSrc = currentSrc;
      stopListening();
    });
  }
  failedSrc = null;
  currentSrc = src;
  audio.src = src;
  const started = audio.play();
  if (started && typeof started.catch === 'function') {
    started.catch(() => {
      if (currentSrc !== src) return;
      failedSrc = src;
      stopListening();
    });
  }
  emit();
}
