/*
 * A-04: createLearner / createLesson / createSeries mint a NEW Idempotency-Key
 * inside every call, so the retry of a submission (timeout, Wi-Fi drop, second
 * tap after an error) is a different request to the server and creates a
 * second record. The key only protects when the caller supplies its own.
 */
import { installMockApi } from '@mock/installMockFetch';
import { createLearner } from '@shared/api/learner';

describe('A-04 default idempotency key changes on every call', () => {
  it('sends a different key for the retry of the same submission and creates two learners', async () => {
    installMockApi();
    const spy = vi.spyOn(globalThis, 'fetch');
    const form = { name: 'Hawa', role: 'learner' as const };

    const first = await createLearner(form);
    // The answer was lost on the way back (timeout); the learner taps "Try again".
    const retry = await createLearner(form);

    const keys = spy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[0]);
    expect(retry.id).not.toBe(first.id); // two "Hawa" learners now exist in the bag
  });

  it('works only when the screen keeps one key for the whole submission', async () => {
    installMockApi();
    const form = { name: 'Hawa', role: 'learner' as const };
    const first = await createLearner(form, { idempotencyKey: 'one-key-per-form' });
    const retry = await createLearner(form, { idempotencyKey: 'one-key-per-form' });
    expect(retry.id).toBe(first.id);
  });
});
