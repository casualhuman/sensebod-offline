/*
 * The add-content flow: its steps, the hand-over of dropped files from the
 * source screen to the upload screen, and the short list of lessons this
 * phone published (for "Recently published" on Home).
 */
import type { AdminSteps } from '../frame/AdminFrame';

export type FlowStep = 'add' | 'place' | 'check';

const PHONE_LABELS = ['Add it', 'Where it goes', 'Check and publish'] as const;
const LAPTOP_LABELS = ['Where it is from', 'Add the files', 'Where it goes', 'Check and publish'] as const;

/**
 * Phones count three steps (ADM-M-*: the source is chosen on Home); the
 * laptop counts four, because "Where is your content from?" is its own
 * screen there (ADM-Source).
 */
export function flowSteps(step: FlowStep | 'source', laptop: boolean): AdminSteps | undefined {
  if (laptop) {
    const current = step === 'source' ? 1 : step === 'add' ? 2 : step === 'place' ? 3 : 4;
    return { current, labels: LAPTOP_LABELS };
  }
  if (step === 'source') return undefined;
  return { current: step === 'add' ? 1 : step === 'place' ? 2 : 3, labels: PHONE_LABELS };
}

/* ---- files dropped on the source screen, picked up by the upload screen ---- */

let handedOver: File[] = [];

/** File objects cannot travel in a URL; they wait here for the next screen. Memory only. */
export function handOverFiles(files: File[]): void {
  handedOver = files;
}

export function takeHandedOverFiles(): File[] {
  const files = handedOver;
  handedOver = [];
  return files;
}

/* ---- "Recently published" ---- */

// TODO(stream-1): the library endpoint has no "most recently edited first"
// order (docs/team/REQUESTS.md). Until it has, Home shows what was published
// from this phone: a short list of lesson ids kept in localStorage. Ids only:
// titles and everything else are read from the bag each time.
const RECENT_KEY = 'sensebod.admin.recent-published.v1';
const RECENT_MAX = 5;

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0 && item.length < 200);
}

export function recentPublishedIds(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return isIdList(raw) ? raw.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberPublished(lessonId: string): void {
  try {
    const ids = [lessonId].concat(recentPublishedIds().filter((id) => id !== lessonId)).slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: Home simply shows no recent list.
  }
}

export function forgetPublished(lessonId: string): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentPublishedIds().filter((id) => id !== lessonId)));
  } catch {
    // As above.
  }
}
