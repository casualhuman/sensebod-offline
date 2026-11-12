/*
 * A-09: the session store trusts whatever JSON is in localStorage. A value
 * that parses but is not an object (here the literal `null`) makes
 * getSession() throw on every start, and useSession() is used by the page
 * shell of every screen including the error screen.
 */
import { getSession, resetSessionForTests } from '@shared/session';

describe('A-09 session store does not validate stored data', () => {
  it('throws when the stored value is JSON null', () => {
    resetSessionForTests();
    window.localStorage.setItem('sensebod.session.v1', 'null');
    expect(() => getSession()).toThrow(TypeError);
  });

  it('accepts a learner of the wrong shape without complaint', () => {
    resetSessionForTests();
    window.localStorage.setItem('sensebod.session.v1', JSON.stringify({ learner: 'Aminata', knownLearners: [null, 7] }));
    const session = getSession();
    expect(session.learner as unknown).toBe('Aminata');
    expect(session.knownLearners as unknown).toEqual([null, 7]);
  });
});
