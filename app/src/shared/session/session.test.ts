import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Learner } from '../api/types';
import {
  clearSensitiveChoices,
  forgetLearner,
  getSession,
  learnAsGuest,
  readStored,
  resetSessionForTests,
  setChildProtectionAudience,
  setLanguage,
  setLearner,
  writeStored,
} from './index';

const KEY = 'sensebod.session.v1';

function learner(n: number): Learner {
  return { id: `learner-${n}`, name: `Name ${n}`, role: 'learner', roleLabel: 'Learner' };
}

/** Puts a raw value on the "phone" and makes the store read it afresh. */
function storeRaw(raw: string): void {
  resetSessionForTests();
  window.localStorage.setItem(KEY, raw);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.lang = 'en';
});

describe('session store', () => {
  it('starts as a guest in English', () => {
    expect(getSession()).toEqual({ learner: null, knownLearners: [], language: 'en', childProtectionAudience: null });
  });

  it('remembers at most 8 names, most recent first, without repeats', () => {
    for (let n = 1; n <= 10; n += 1) setLearner(learner(n));
    setLearner(learner(5));
    const { knownLearners, learner: current } = getSession();
    expect(current?.id).toBe('learner-5');
    expect(knownLearners).toHaveLength(8);
    expect(knownLearners.map((known) => known.id)).toEqual(['learner-5', 'learner-10', 'learner-9', 'learner-8', 'learner-7', 'learner-6', 'learner-4', 'learner-3']);
  });

  it('keeps the name in the list when learning as a guest', () => {
    setLearner(learner(1));
    learnAsGuest();
    expect(getSession().learner).toBeNull();
    expect(getSession().knownLearners.map((known) => known.id)).toEqual(['learner-1']);
  });

  it('forgets the current learner, and another one without touching the current', () => {
    setLearner(learner(1));
    setLearner(learner(2));
    forgetLearner('learner-1');
    expect(getSession().learner?.id).toBe('learner-2');
    expect(getSession().knownLearners.map((known) => known.id)).toEqual(['learner-2']);
    forgetLearner('learner-2');
    expect(getSession().learner).toBeNull();
    expect(getSession().knownLearners).toEqual([]);
  });

  it('"Leave this page" forgets the audience choice and keeps the learner', () => {
    setLearner(learner(1));
    setChildProtectionAudience('cp-child');
    clearSensitiveChoices();
    expect(getSession().childProtectionAudience).toBeNull();
    expect(getSession().learner?.id).toBe('learner-1');
  });

  it('writes to the phone and reads it back on the next start', () => {
    setLearner(learner(3));
    setLanguage('kri');
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { learner: Learner; language: string };
    expect(stored.learner.id).toBe('learner-3');
    expect(stored.language).toBe('kri');
    // A new page load: the in-memory state is gone, the phone still has it.
    storeRaw(JSON.stringify(stored));
    expect(getSession().learner?.name).toBe('Name 3');
    expect(getSession().language).toBe('kri');
  });

  it('leaves the document language alone while the text is still English (A-11)', () => {
    setLanguage('kri');
    expect(getSession().language).toBe('kri');
    expect(document.documentElement.lang).toBe('en');
    storeRaw(JSON.stringify({ language: 'kri' }));
    expect(getSession().language).toBe('kri');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('session store with damaged or old data on the phone (A-09)', () => {
  it.each([['null'], ['7'], ['"Aminata"'], ['[1,2]'], ['{not json'], ['true']])('starts as a guest when the stored value is %s', (raw) => {
    storeRaw(raw);
    expect(getSession()).toEqual({ learner: null, knownLearners: [], language: 'en', childProtectionAudience: null });
  });

  it('drops a learner and list entries of the wrong shape, keeps the good ones', () => {
    storeRaw(
      JSON.stringify({
        learner: 'Aminata',
        knownLearners: [null, 7, { id: 'learner-1' }, { name: 'No id' }, learner(2), learner(2), { id: '', name: 'Empty id' }],
        language: 'fr',
        childProtectionAudience: 12,
      }),
    );
    const session = getSession();
    expect(session.learner).toBeNull();
    expect(session.knownLearners).toEqual([learner(2)]);
    expect(session.language).toBe('en');
    expect(session.childProtectionAudience).toBeNull();
  });

  it('keeps no more than 8 stored names', () => {
    const many: Learner[] = [];
    for (let n = 1; n <= 12; n += 1) many.push(learner(n));
    storeRaw(JSON.stringify({ knownLearners: many }));
    expect(getSession().knownLearners).toHaveLength(8);
  });
});

describe('storage that is missing or full', () => {
  it('keeps working for this page load when writing throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    setLearner(learner(1));
    expect(getSession().learner?.id).toBe('learner-1');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('falls back to what it kept in memory when reading throws', () => {
    writeStored('sensebod.test', { a: 1 });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(readStored('sensebod.test', null)).toEqual({ a: 1 });
    expect(readStored('sensebod.never-written', 'fallback')).toBe('fallback');
    resetSessionForTests();
    expect(getSession().learner).toBeNull();
  });
});
