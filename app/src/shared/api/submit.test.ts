import { getMockDb } from '@mock/handler';
import { installMockApi, type MockApiHandle } from '@mock/installMockFetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeries } from './admin';
import { api, ApiError, forgetSubmissions, uploadFile } from './client';
import { createLearner, getPortals, getSeries, saveLessonProgress } from './learner';

let mock: MockApiHandle;

function sentKeys(spy: { mock: { calls: unknown[][] } }): (string | undefined)[] {
  return spy.mock.calls.map(([, init]) => ((init as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.['Idempotency-Key']);
}

beforeEach(() => {
  mock = installMockApi();
  forgetSubmissions();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one Idempotency-Key per submission (A-04)', () => {
  const form = { name: 'Hawa', role: 'learner' as const, pin: '1234' };
  const hawas = () => getMockDb().learners.filter((learner) => learner.name === 'Hawa');

  it('a timed-out "Save and start learning" followed by "Try again" makes one learner', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // The request reaches the bag, but the answer comes after this phone gave up.
    mock.setDelay(60);
    const first = await createLearner(form, { timeoutMs: 20 }).catch((error: unknown) => error);
    expect(first).toMatchObject({ kind: 'timeout' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(hawas()).toHaveLength(1);

    mock.setDelay(0);
    const retry = await createLearner(form);
    expect(sentKeys(spy)[1]).toBe(sentKeys(spy)[0]);
    expect(hawas()).toHaveLength(1);
    expect(retry.id).toBe(hawas()[0]?.id);
  });

  it('a double tap (two calls in flight) makes one learner', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const [a, b] = await Promise.all([createLearner(form), createLearner(form)]);
    expect(sentKeys(spy)[0]).toBeTruthy();
    expect(sentKeys(spy)[1]).toBe(sentKeys(spy)[0]);
    expect(b.id).toBe(a.id);
    expect(hawas()).toHaveLength(1);
  });

  it('a second tap just after the answer is still the same submission', async () => {
    const first = await createLearner(form);
    const again = await createLearner(form);
    expect(again.id).toBe(first.id);
    expect(hawas()).toHaveLength(1);
  });

  it('a later, separate submission of the same words gets a new key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const spy = vi.spyOn(globalThis, 'fetch');
    const first = await createLearner(form);
    vi.setSystemTime(Date.now() + 6000);
    // Another Hawa, later: same words on the form except her own number.
    const second = await createLearner({ ...form, pin: '5678' });
    expect(sentKeys(spy)[1]).not.toBe(sentKeys(spy)[0]);
    expect(second.id).not.toBe(first.id);
  });

  it('a different form is a different submission', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const hawa = await createLearner(form);
    const musa = await createLearner({ name: 'Musa', role: 'learner', pin: '1234' });
    expect(sentKeys(spy)[1]).not.toBe(sentKeys(spy)[0]);
    expect(musa.id).not.toBe(hawa.id);
  });

  it('renews the key after the bag refuses the submission, keeps it after a server error', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    mock.failNext(400);
    await createLearner(form).catch(() => undefined);
    await createLearner(form);
    expect(sentKeys(spy)[1]).not.toBe(sentKeys(spy)[0]);

    forgetSubmissions();
    spy.mockClear();
    const other = { name: 'Isatu', role: 'learner' as const, pin: '1234' };
    mock.failNext(503);
    const failed = await createLearner(other).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(ApiError);
    await createLearner(other);
    expect(sentKeys(spy)[1]).toBe(sentKeys(spy)[0]);
  });

  it('leaves a key passed by the screen alone', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await createLearner(form, { idempotencyKey: 'mine' });
    await createLearner({ ...form, pin: '5678' }, { idempotencyKey: 'mine-2' });
    expect(sentKeys(spy)).toEqual(['mine', 'mine-2']);
    expect(hawas()).toHaveLength(2);
  });

  it('covers "Start a new series" for admins the same way', async () => {
    mock.signInAdmin();
    const group = getMockDb().groups.find((g) => g.portalId === 'climate');
    const input = { portalId: 'climate' as const, groupId: group?.id ?? '', title: 'New series for the test' };
    const [a, b] = await Promise.all([createSeries(input), createSeries(input)]);
    expect(b.id).toBe(a.id);
    expect(getMockDb().series.filter((s) => s.title === input.title)).toHaveLength(1);
  });
});

describe('client header (CSRF defence of the contract)', () => {
  it('goes with every request, so the bag accepts saves, sign-in and uploads', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await createLearner({ name: 'Hawa', role: 'learner', pin: '1234' });
    await getPortals();
    const sent = spy.mock.calls.map(([, init]) => ((init as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.['X-Sensebod-Offline-Client']);
    expect(sent).toEqual(['1', '1']);
  });
});

describe('GET cache (A-12)', () => {
  it('saving progress does not empty the content cache', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await getSeries('cp-child-staying-safe');
    await saveLessonProgress('learner-aminata', 'cp-child-staying-safe-3', { state: 'started' });
    await createLearner({ name: 'Hawa', role: 'learner', pin: '1234' });
    await getSeries('cp-child-staying-safe');
    // series, progress save, learner: the second getSeries came from the cache.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('an admin write empties it, because content may have changed', async () => {
    mock.signInAdmin();
    const spy = vi.spyOn(globalThis, 'fetch');
    await getPortals();
    await api.post('/admin/lessons/cp-child-staying-safe-1/unpublish');
    await getPortals();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('refreshing an answer that is already cached does not push the oldest one out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Fill the cache to its limit of 40 answers.
    for (let n = 0; n < 40; n += 1) await api.get('/portals', { n }, { cacheMs: 60000 });
    vi.setSystemTime(Date.now() + 50);
    const spy = vi.spyOn(globalThis, 'fetch');
    // Too old for this caller: asked again and stored again under the same key.
    await api.get('/portals', { n: 39 }, { cacheMs: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
    // The oldest answer is still there.
    await api.get('/portals', { n: 0 }, { cacheMs: 60000 });
    expect(spy).toHaveBeenCalledTimes(1);
    // A really new answer does push the oldest out.
    await api.get('/portals', { n: 40 }, { cacheMs: 60000 });
    await api.get('/portals', { n: 0 }, { cacheMs: 60000 });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

/** A hand-driven XMLHttpRequest, to reach the paths the mock server never takes. */
class ManualXhr {
  static last: ManualXhr;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: unknown = undefined;
  constructor() {
    ManualXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.sent = body;
  }
  abort(): void {
    if (this.onabort) this.onabort();
  }
  answer(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    if (this.onload) this.onload();
  }
}

describe('uploadFile', () => {
  const file = new Blob(['video bytes'], { type: 'video/mp4' });

  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', ManualXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the file as the body with its name and type, and reports progress', async () => {
    const progress: [number, number][] = [];
    const handle = uploadFile<{ id: string }>('/admin/uploads', file, 'Quail housing.mp4', { smallerCopy: true }, (sent, total) => progress.push([sent, total]));
    const xhr = ManualXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/v1/admin/uploads?smallerCopy=true');
    expect(xhr.headers['Content-Type']).toBe('video/mp4');
    expect(xhr.headers['X-File-Name']).toBe('Quail%20housing.mp4');
    expect(xhr.headers['X-Sensebod-Offline-Client']).toBe('1');
    expect(xhr.sent).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 11 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 11, total: 11 });
    xhr.answer(201, JSON.stringify({ id: 'upload-1' }));
    expect(await handle.promise).toEqual({ id: 'upload-1' });
    expect(progress).toEqual([
      [4, 11],
      [11, 11],
    ]);
  });

  it('"Stop uploading" rejects with kind "aborted"', async () => {
    const handle = uploadFile('/admin/uploads', file, 'a.mp4');
    handle.abort();
    await expect(handle.promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('maps an error answer to the message and the fields', async () => {
    const handle = uploadFile('/admin/uploads', file, 'a.exe');
    ManualXhr.last.answer(422, JSON.stringify({ error: { code: 'invalid', message: 'This kind of file cannot be used.', fields: { file: 'Choose a video, sound, document or picture.' } } }));
    const error = (await handle.promise.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 422, code: 'invalid', message: 'This kind of file cannot be used.' });
    expect(error.fields).toEqual({ file: 'Choose a video, sound, document or picture.' });
  });

  it('keeps a plain message when the error answer is not JSON (an nginx page)', async () => {
    const handle = uploadFile('/admin/uploads', file, 'a.mp4');
    ManualXhr.last.answer(413, '<html>Request Entity Too Large</html>');
    await expect(handle.promise).rejects.toMatchObject({ kind: 'http', status: 413, message: 'The upload did not finish (413).' });
  });

  it('treats a 2xx answer it cannot read as a parse error, not as success', async () => {
    const handle = uploadFile('/admin/uploads', file, 'a.mp4');
    ManualXhr.last.answer(200, 'not json');
    await expect(handle.promise).rejects.toMatchObject({ kind: 'parse', status: 200 });
    const empty = uploadFile('/admin/uploads', file, 'a.mp4');
    ManualXhr.last.answer(204, '');
    await expect(empty.promise).rejects.toMatchObject({ kind: 'parse' });
  });

  it('reports a dropped connection as a network error', async () => {
    const handle = uploadFile('/admin/uploads', file, 'a.mp4');
    ManualXhr.last.onerror?.();
    await expect(handle.promise).rejects.toMatchObject({ kind: 'network', retryable: true });
  });
});
