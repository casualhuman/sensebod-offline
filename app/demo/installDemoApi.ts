/*
 * Online demo only (`npm run build:demo`, VITE_DEMO=1). Never part of the Pi build.
 *
 * Answers `/api/...` inside the browser with the same mock the dev server and
 * the tests use (mock/handler.ts), so the demo needs no server: any static
 * host can serve it. Every other request (pages, pictures, /media/ sample
 * clips, the `/?reach=` check) goes to the network as usual.
 *
 * State lives in this tab's memory: a reload starts again from the sample data.
 */
import { handleMockRequest, mockControls, type MockResponse } from '../mock/handler.ts';

const realFetch = window.fetch.bind(window);
const RealXhr = window.XMLHttpRequest;
let cookie = '';

// A little latency so loading states look as they would on a Pi.
mockControls.setDelay(150);

function remember(response: MockResponse): void {
  const setCookie = response.headers ? response.headers['Set-Cookie'] : undefined;
  if (!setCookie) return;
  cookie = /Max-Age=0/.test(setCookie) ? '' : (setCookie.split(';')[0] ?? '');
}

/** The path and query of a same-origin `/api/` address, or null for anything else. */
function apiUrl(input: string): { path: string; query: URLSearchParams } | null {
  const url = new URL(input, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.indexOf('/api/') !== 0) return null;
  return { path: url.pathname, query: url.searchParams };
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const target = apiUrl(href);
  if (!target) return realFetch(input, init);
  const options = init ?? {};
  const headers: Record<string, string> = { cookie, host: window.location.host };
  new Headers(options.headers).forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const signal = options.signal;
  if (signal && signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const pending = handleMockRequest({
    method: (options.method ?? 'GET').toUpperCase(),
    path: target.path,
    query: target.query,
    headers,
    body: parseBody(options.body),
    bodyBytes: typeof options.body === 'string' ? options.body.length : 0,
  });
  return new Promise<MockResponse>((resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    pending.then(resolve, reject);
  }).then((result) => {
    remember(result);
    const empty = result.body === undefined || result.status === 204;
    return new Response(empty ? null : JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/**
 * XMLHttpRequest is used only for uploads (shared/api/client.ts, uploadFile).
 * API calls are answered by the mock (it counts the bytes, keeps nothing);
 * anything else is passed to the browser's own XMLHttpRequest.
 */
class DemoXhr {
  status = 0;
  responseText = '';
  readyState = 0;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  timeout = 0;
  private method = 'GET';
  private url = '';
  private headers: Record<string, string> = {};
  private aborted = false;
  private real: XMLHttpRequest | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    if (!apiUrl(url)) {
      const real = new RealXhr();
      real.open(method, url);
      this.real = real;
    }
  }
  setRequestHeader(name: string, value: string): void {
    if (this.real) this.real.setRequestHeader(name, value);
    else this.headers[name.toLowerCase()] = value;
  }
  abort(): void {
    this.aborted = true;
    if (this.real) this.real.abort();
    else if (this.onabort) this.onabort();
  }
  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    const real = this.real;
    if (real) {
      real.upload.onprogress = (event) => {
        if (this.upload.onprogress) this.upload.onprogress(event);
      };
      real.onload = () => {
        this.status = real.status;
        this.responseText = real.responseText;
        this.readyState = 4;
        if (this.onload) this.onload();
      };
      real.onerror = () => {
        if (this.onerror) this.onerror();
      };
      real.onabort = () => {
        if (this.onabort) this.onabort();
      };
      real.timeout = this.timeout;
      real.send(body);
      return;
    }
    const target = apiUrl(this.url);
    if (!target) return;
    const size = body instanceof Blob ? body.size : typeof body === 'string' ? body.length : 0;
    if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: size, total: size });
    handleMockRequest({ method: this.method.toUpperCase(), path: target.path, query: target.query, headers: { ...this.headers, cookie, host: window.location.host }, bodyBytes: size }).then(
      (result) => {
        if (this.aborted) return;
        remember(result);
        this.status = result.status;
        this.responseText = result.body === undefined ? '' : JSON.stringify(result.body);
        this.readyState = 4;
        if (this.onload) this.onload();
      },
      () => {
        if (!this.aborted && this.onerror) this.onerror();
      },
    );
  }
}

window.fetch = demoFetch as typeof fetch;
(window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = DemoXhr;
