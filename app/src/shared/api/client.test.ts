import { installMockApi, type MockApiHandle } from '@mock/installMockFetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildUrl, describeError } from './client';
import { createLearner, getLesson, getPortals, getProgress, getSeries, saveLessonProgress } from './learner';

let mock: MockApiHandle;
beforeEach(() => {
  mock = installMockApi();
});

describe('api client', () => {
  it('uses a relative base path and skips empty query values', () => {
    expect(buildUrl('/portals')).toBe('/api/v1/portals');
    expect(buildUrl('/admin/lessons', { type: 'watch', search: '', page: 2, status: undefined })).toBe('/api/v1/admin/lessons?type=watch&page=2');
  });

  it('returns typed data', async () => {
    const portals = await getPortals();
    expect(portals.map((p) => p.id)).toEqual(['primary', 'jss', 'child-protection', 'agriculture', 'climate']);
  });

  it('turns an HTTP error body into an ApiError', async () => {
    const error = await getLesson('does-not-exist').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 404, code: 'not_found', retryable: false });
    expect(describeError(error)).toBe('This is not in this bag.');
  });

  it('reports validation problems per field', async () => {
    const error = (await createLearner({ name: '  ', role: 'learner' }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(422);
    expect(error.fields.name).toBe('Type your name first.');
    expect(describeError(error)).toBe('Type your name first.');
  });

  it('marks server failures as retryable and keeps the message plain', async () => {
    mock.failNext(503);
    const error = (await api.get('/portals').catch((e: unknown) => e)) as ApiError;
    expect(error.retryable).toBe(true);
    expect(describeError(error)).toMatch(/Nothing is lost/);
  });

  it('times out', async () => {
    mock.setDelay(200);
    const error = (await api.get('/portals', undefined, { timeoutMs: 20 }).catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('timeout');
    expect(describeError(error)).toMatch(/cannot reach the bag/);
  });

  it('can be cancelled', async () => {
    mock.setDelay(100);
    const controller = new AbortController();
    const pending = api.get('/portals', undefined, { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    expect(((await pending) as ApiError).kind).toBe('aborted');
  });

  it('reports a network failure', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = (await api.get('/portals').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('shares identical GETs in flight and reuses a fresh cached answer', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const [a, b] = await Promise.all([getSeries('cp-child-staying-safe'), getSeries('cp-child-staying-safe')]);
    expect(a).toBe(b);
    await getSeries('cp-child-staying-safe');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps cached content answers after a learner write (admin writes are covered in submit.test.ts)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await getPortals();
    await saveLessonProgress('learner-aminata', 'cp-child-staying-safe-3', { state: 'started' });
    await getPortals();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not create a second learner when the same submission is repeated', async () => {
    const first = await api.post<{ id: string }>('/learners', { name: 'Hawa', role: 'learner' }, { idempotencyKey: 'k1' });
    const again = await api.post<{ id: string }>('/learners', { name: 'Hawa', role: 'learner' }, { idempotencyKey: 'k1' });
    expect(again.id).toBe(first.id);
  });

  it('saves and reads progress', async () => {
    const learner = await createLearner({ name: 'Hawa', role: 'learner' });
    await saveLessonProgress(learner.id, 'cp-child-staying-safe-1', { state: 'finished' });
    await saveLessonProgress(learner.id, 'cp-child-staying-safe-1', { state: 'started' });
    const progress = await getProgress(learner.id, { seriesId: 'cp-child-staying-safe' });
    expect(progress.lessons).toHaveLength(1);
    expect(progress.lessons[0]?.state).toBe('finished');
  });
});
