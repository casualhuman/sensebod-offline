/*
 * Test helper: routes `fetch` and `XMLHttpRequest` to the mock API, in
 * memory, with no network. Call it from a test file:
 *
 *   import { installMockApi } from '@mock/installMockFetch';
 *   beforeEach(() => { installMockApi(); });
 *
 * It resets the mock database to the seed each time, and remembers the admin
 * session cookie the way a browser would.
 */
import { clearApiCache, forgetSubmissions } from '../src/shared/api/client.ts';
import { handleMockRequest, mockControls, resetMockDb, type MockResponse } from './handler.ts';

let cookie = '';

function remember(response: MockResponse): void {
  const setCookie = response.headers?.['Set-Cookie'];
  if (!setCookie) return;
  cookie = /Max-Age=0/.test(setCookie) ? '' : (setCookie.split(';')[0] ?? '');
}

function splitUrl(input: string): { path: string; query: URLSearchParams } {
  const url = new URL(input, 'http://sensebod.test');
  return { path: url.pathname, query: url.searchParams };
}

async function mockFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { path, query } = splitUrl(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const headers: Record<string, string> = { cookie };
  new Headers(init.headers).forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const signal = init.signal;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const pending = handleMockRequest({
    method: (init.method ?? 'GET').toUpperCase(),
    path,
    query,
    headers,
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    bodyBytes: typeof init.body === 'string' ? init.body.length : 0,
  });
  const result = await new Promise<MockResponse>((resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    pending.then(resolve, reject);
  });
  remember(result);
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Just enough of XMLHttpRequest for `uploadFile` (shared/api/client.ts). */
class MockXhr {
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private method = 'GET';
  private url = '';
  private headers: Record<string, string> = {};
  private aborted = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }
  abort(): void {
    this.aborted = true;
    if (this.onabort) this.onabort();
  }
  send(body?: Blob | null): void {
    const size = body ? body.size : 0;
    const { path, query } = splitUrl(this.url);
    if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: size, total: size });
    handleMockRequest({ method: this.method, path, query, headers: { ...this.headers, cookie }, bodyBytes: size }).then(
      (result) => {
        if (this.aborted) return;
        this.status = result.status;
        this.responseText = result.body === undefined ? '' : JSON.stringify(result.body);
        if (this.onload) this.onload();
      },
      () => {
        if (!this.aborted && this.onerror) this.onerror();
      },
    );
  }
}

export interface MockApiHandle {
  /** Make the next `count` requests fail with this status (to test error states). */
  failNext: (status?: number, count?: number) => void;
  /** Delay every answer (to test loading states and timeouts). */
  setDelay: (ms: number) => void;
  /** Sign the mock admin in without going through the form. */
  signInAdmin: () => void;
}

export function installMockApi(): MockApiHandle {
  resetMockDb();
  mockControls.setDelay(0);
  clearApiCache();
  forgetSubmissions();
  cookie = '';
  globalThis.fetch = mockFetch as typeof fetch;
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = MockXhr;
  return {
    failNext: (status = 500, count = 1) => mockControls.failNext(status, count),
    setDelay: (ms) => mockControls.setDelay(ms),
    signInAdmin: () => {
      cookie = 'sb_admin=mock-session';
    },
  };
}
