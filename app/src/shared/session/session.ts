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

function load(): SessionState {
  const stored = readStored<Partial<SessionState>>(KEY, {});
  return {
    learner: stored.learner ?? null,
    knownLearners: Array.isArray(stored.knownLearners) ? stored.knownLearners : [],
    language: stored.language === 'kri' ? 'kri' : 'en',
    childProtectionAudience: stored.childProtectionAudience ?? null,
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

export function setLanguage(language: LanguageCode): void {
  update({ ...getSession(), language });
  document.documentElement.lang = language === 'kri' ? 'kri' : 'en';
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
