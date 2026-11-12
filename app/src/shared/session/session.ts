/*
 * Who is learning on this phone, and in which language.
 *
 * Only small settings live here (localStorage, a few hundred bytes):
 *  - the names used on this phone ("Used this phone before? Tap your name")
 *  - which of them is learning now (none = guest)
 *  - the chosen language
 *  - the Child protection audience choice ("You chose: I am a child")
 * Progress itself is stored in the bag through the API, never on the phone.
 * No password, no phone number, nothing sensitive.
 */
import { useSyncExternalStore } from 'react';
import type { LanguageCode, Learner } from '../api/types';
import { readStored, removeStored, writeStored } from './storage';

const KEY = 'sensebod.session.v1';
const MAX_KNOWN_LEARNERS = 8;

export interface SessionState {
  /** The learner whose progress is being saved, or null for a guest. */
  learner: Learner | null;
  /** Names used on this phone, most recent first. */
  knownLearners: Learner[];
  language: LanguageCode;
  /** Group id chosen on "Who are you?" in Child protection, or null. */
  childProtectionAudience: string | null;
}


let state: SessionState | null = null;
const listeners = new Set<() => void>();

/** Keeps a stored learner only if it has the two fields every screen reads. */
function asLearner(value: unknown): Learner | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<Learner>;
  if (typeof candidate.id !== 'string' || candidate.id === '' || typeof candidate.name !== 'string') return null;
  return value as Learner;
}

/**
 * Reads the stored session. Whatever is on the phone is checked, never
 * trusted: phones are shared and long-lived, and an older or damaged value
 * must give a guest session, not a blank page.
 */
function load(): SessionState {
  const raw = readStored<unknown>(KEY, null);
  const stored = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const known: Learner[] = [];
  if (Array.isArray(stored.knownLearners)) {
    for (const item of stored.knownLearners) {
      const learner = asLearner(item);
      if (learner && !known.some((other) => other.id === learner.id)) known.push(learner);
    }
  }
  return {
    learner: asLearner(stored.learner),
    knownLearners: known.slice(0, MAX_KNOWN_LEARNERS),
    language: stored.language === 'kri' ? 'kri' : 'en',
    childProtectionAudience: typeof stored.childProtectionAudience === 'string' ? stored.childProtectionAudience : null,
  };
}

export function getSession(): SessionState {
  if (!state) state = load();
  return state;
}

function update(next: SessionState): void {
  state = next;
  writeStored(KEY, next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribes a component to the session. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSession);
}

/** Start learning as this person (after "Save and start learning" or tapping a name). */
export function setLearner(learner: Learner): void {
  const current = getSession();
  const others = current.knownLearners.filter((known) => known.id !== learner.id);
  update({ ...current, learner, knownLearners: [learner, ...others].slice(0, MAX_KNOWN_LEARNERS) });
}

/** "Skip — learn as a guest" or "Change": stop saving progress, keep the name in the list. */
export function learnAsGuest(): void {
  update({ ...getSession(), learner: null });
}

/** "Remove a name": forget this person on this phone. Call learnerApi.deleteLearner too. */
export function forgetLearner(learnerId: string): void {
  const current = getSession();
  update({
    ...current,
    learner: current.learner && current.learner.id === learnerId ? null : current.learner,
    knownLearners: current.knownLearners.filter((known) => known.id !== learnerId),
  });
}

/**
 * Remembers the chosen language. The document's `lang` is deliberately left
 * at "en": every string on screen is still English, and marking the page as
 * Krio would make a screen reader pronounce English words with the wrong
 * rules. When translated text exists, set `document.documentElement.lang`
 * here AND at start-up in app/main.tsx (from getSession().language).
 */
export function setLanguage(language: LanguageCode): void {
  update({ ...getSession(), language: language === 'kri' ? 'kri' : 'en' });
}

export function setChildProtectionAudience(groupId: string | null): void {
  update({ ...getSession(), childProtectionAudience: groupId });
}

/**
 * "Leave this page": forget the Child protection choice so the next person
 * who picks up a shared phone does not see who was reading.
 */
export function clearSensitiveChoices(): void {
  update({ ...getSession(), childProtectionAudience: null });
}

/** Tests only. */
export function resetSessionForTests(): void {
  state = null;
  removeStored(KEY);
}
