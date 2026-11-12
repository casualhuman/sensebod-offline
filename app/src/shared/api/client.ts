import type { ApiErrorBody } from './types';

/**
 * Small fetch wrapper for the Pi's API.
 *
 *  - relative base path (`/api/v1`): works on whatever hostname or IP the bag uses
 *  - every request has a timeout and can be cancelled
 *  - identical GETs that are already in flight are shared, not repeated
 *  - a small, bounded, short-lived GET cache makes Back navigation instant
 *  - no automatic retries: the UI offers "Try again" instead, so a struggling
 *    Pi is not hammered by many tablets at once
 *
 * `AbortController` does not exist before Chrome 66; on those browsers a
 * cancelled or timed-out request is simply ignored when it settles.
 */

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

export const DEFAULT_TIMEOUT_MS = 15000;
const CACHE_MAX_ENTRIES = 40;

export type ApiErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, 0 when no response arrived. */
  readonly status: number;
  /** Machine code from the server's error body, if any. */
  readonly code: string | null;
  /** Field name → problem, for forms. */
  readonly fields: Record<string, string>;

  constructor(kind: ApiErrorKind, message: string, status = 0, code: string | null = null, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** True when trying again later may work (bag Wi-Fi dropped, Pi restarting). */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.status >= 500;
  }
}

/** A plain sentence for the error message component. Never leaks technical detail. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network' || error.kind === 'timeout') {
      return 'This phone cannot reach the bag. Check you are on the bag’s Wi-Fi, then try again.';
    }
    if (error.status === 404) return 'This is not in this bag.';
    if (error.status === 401 || error.status === 403) return 'You need to sign in to do this.';
    if (error.kind === 'http' && error.status < 500 && error.message) return error.message;
  }
  return 'Something went wrong. Nothing is lost. Please try again.';
}

export function isAbort(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'aborted';
}

export interface RequestOptions {
  /** Cancels the request (pass the signal from `useApi`, or your own controller). */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** GET only: reuse an answer younger than this many milliseconds. 0 (default) = always ask the Pi. */
  cacheMs?: number;
  /** POST only: lets the server recognise a repeated submission of the same action. */
  idempotencyKey?: string;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Forget cached GET answers. Called automatically after every write. */
export function clearApiCache(): void {
  cache.clear();
}

export function buildUrl(path: string, query?: Query): string {
  let url = API_BASE + path;
  if (query) {
    const parts: string[] = [];
    for (const key of Object.keys(query)) {
      const value = query[key];
      if (value === undefined || value === null || value === '') continue;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    if (parts.length > 0) url += '?' + parts.join('&');
  }
  return url;
}

function remember(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

async function parseError(response: Response): Promise<ApiError> {
  let code: string | null = null;
  let message = '';
  let fields: Record<string, string> = {};
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error) {
      code = body.error.code ?? null;
      message = body.error.message ?? '';
      fields = body.error.fields ?? {};
    }
  } catch {
    // Not JSON (for example an nginx error page): keep the generic message.
  }
  return new ApiError('http', message || `The bag answered with an error (${response.status}).`, response.status, code, fields);
}

async function send<T>(method: string, url: string, body: unknown, options: RequestOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let settled = false;
  let timedOut = false;
  let cancelled = false;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  return new Promise<T>((resolve, reject) => {
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      run();
    };
    const onAbort = () => {
      cancelled = true;
      if (controller) controller.abort();
      finish(() => reject(new ApiError('aborted', 'Cancelled.')));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (controller) controller.abort();
      finish(() => reject(new ApiError('timeout', 'The bag took too long to answer.')));
    }, timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort);
    }

    fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller ? controller.signal : undefined,
    })
      .then(async (response) => {
        if (!response.ok) throw await parseError(response);
        if (response.status === 204) return undefined as T;
        try {
          return (await response.json()) as T;
        } catch {
          throw new ApiError('parse', 'The bag sent an answer this page could not read.', response.status);
        }
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) =>
          finish(() => {
            if (error instanceof ApiError) reject(error);
            else if (cancelled) reject(new ApiError('aborted', 'Cancelled.'));
            else if (timedOut) reject(new ApiError('timeout', 'The bag took too long to answer.'));
            else reject(new ApiError('network', 'Could not reach the bag.'));
          }),
      );
  });
}

function get<T>(path: string, query?: Query, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, query);
  const cacheMs = options.cacheMs ?? 0;
  if (cacheMs > 0) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < cacheMs) return Promise.resolve(hit.value as T);
  }
  // Share one network request between identical GETs, unless the caller
  // brought its own signal (its cancellation must not cancel the others).
  if (!options.signal) {
    const pending = inFlight.get(url);
    if (pending) return pending as Promise<T>;
  }
  const request = send<T>('GET', url, undefined, options).then(
    (value) => {
      inFlight.delete(url);
      if (cacheMs > 0) remember(url, value);
      return value;
    },
    (error: unknown) => {
      inFlight.delete(url);
      throw error;
    },
  );
  if (!options.signal) inFlight.set(url, request);
  return request;
}

function write<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return send<T>(method, buildUrl(path), body, options).then((value) => {
    clearApiCache();
    return value;
  });
}

export const api = {
  get,
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => write<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => write<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => write<T>('PATCH', path, body, options),
  delete: <T = void>(path: string, options?: RequestOptions) => write<T>('DELETE', path, undefined, options),
};

/** A key for `idempotencyKey`. Not a security token. */
export function newRequestKey(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export interface UploadHandle<T> {
  promise: Promise<T>;
  /** Stops the upload ("Stop uploading"). The promise rejects with kind "aborted". */
  abort: () => void;
}

/**
 * Sends one file as the raw request body, reporting progress. XMLHttpRequest
 * is used because fetch cannot report upload progress on the target browsers.
 * No timeout: a 34 MB video over the bag's Wi-Fi may take minutes.
 */
export function uploadFile<T>(
  path: string,
  file: Blob,
  fileName: string,
  query?: Query,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', buildUrl(path, query));
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(fileName));
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
    }
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body !== null) {
        clearApiCache();
        resolve(body as T);
        return;
      }
      const error = (body as Partial<ApiErrorBody> | null)?.error;
      reject(
        new ApiError(
          xhr.status >= 200 && xhr.status < 300 ? 'parse' : 'http',
          error?.message || `The upload did not finish (${xhr.status}).`,
          xhr.status,
          error?.code ?? null,
          error?.fields ?? {},
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError('network', 'Could not reach the bag.'));
    xhr.onabort = () => reject(new ApiError('aborted', 'Cancelled.'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
