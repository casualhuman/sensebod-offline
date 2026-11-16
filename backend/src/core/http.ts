/*
 * HTTP plumbing shared by every route: request state, the request event log
 * (route template only, R-9), Host allow-list and CSRF header (R-10), JSON
 * bodies, ETag answers and the error handler.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import type { Ctx } from './context.ts';
import { requestStore } from './context.ts';
import { SqliteBusyError, SqliteCorruptError, SqliteFullError } from './db.ts';
import { ApiError, busy, forbidden, invalid, maintenance, storageFull, tooLarge } from './errors.ts';
import { log, logError } from './log.ts';
import { BusyError } from './writeGate.ts';

export interface AdminIdentity {
  id: string;
  username: string;
  displayName: string;
  role: 'hub_manager' | 'admin';
  mustChangePassword: boolean;
  /** The stored hash of the session token: the key of this session. */
  sessionKey: string;
  /** Signed in with an override code: may only set a new password. */
  overrideSession: boolean;
}

export interface ReqState {
  arrivedAt: number;
  ip: string;
  admin: AdminIdentity | null;
  body: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sb: ReqState;
    }
  }
}

export const API_BASE = '/api/v1';

function clientIp(req: Request, trustProxy: boolean): string {
  const remote = req.socket.remoteAddress ?? '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (trustProxy && local) {
    // nginx on the bag sets `X-Forwarded-For $remote_addr` (app/deploy/nginx.conf): one value, replaced, not
    // appended. Should a list ever arrive, only its last entry was written by our own proxy.
    const forwarded = req.headers['x-forwarded-for'];
    const last = typeof forwarded === 'string' ? (forwarded.split(',').pop() ?? '').trim() : '';
    if (/^[0-9A-Fa-f:.]{3,45}$/.test(last)) return last.replace(/^::ffff:/, '');
  }
  return remote.replace(/^::ffff:/, '');
}

/** First middleware: request state, the in-flight cap (T-11) and the async context used by the write gate. */
export function requestState(ctx: Ctx): RequestHandler {
  let inFlight = 0;
  return (req, res, next) => {
    req.sb = { arrivedAt: performance.now(), ip: clientIp(req, ctx.config.server.trustProxy), admin: null, body: undefined };
    if (inFlight >= ctx.config.server.maxInFlight) {
      sendError(res, busy());
      return;
    }
    inFlight += 1;
    let counted = true;
    const done = () => {
      if (counted) {
        counted = false;
        inFlight -= 1;
      }
    };
    res.on('finish', done);
    res.on('close', done);
    requestStore.run({ arrivedAt: req.sb.arrivedAt }, next);
  };
}

/** `/learners/:learnerId/progress/:lessonId` → `/learners/{learnerId}/progress/{lessonId}`. */
function routeTemplate(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  if (!route || typeof route.path !== 'string') return 'unmatched';
  const full = (req.baseUrl + route.path).replace(API_BASE, '') || '/';
  return full.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * One event per request: the route template, status, duration and role.
 * Never the path, the query string, an id, a name, a token or the client IP
 * (SYSTEM-ARCHITECTURE §12.3, V-001).
 */
export function requestLog(): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      log('http', {
        route: `${req.method} ${routeTemplate(req)}`,
        status: res.statusCode,
        ms: Math.round(performance.now() - req.sb.arrivedAt),
        role: req.sb.admin ? req.sb.admin.role : 'anon',
      });
    });
    next();
  };
}

export function maintenanceGate(ctx: Ctx): RequestHandler {
  return (req, _res, next) => {
    if (req.path !== `${API_BASE}/health` && ctx.inMaintenance()) {
      next(maintenance());
      return;
    }
    next();
  };
}

function hostName(header: string | undefined): string {
  if (!header) return '';
  const value = header.toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  const colon = value.lastIndexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/** Host allow-list: the API answers only for the bag's own names and addresses (R-10). */
export function hostAllowList(ctx: Ctx): RequestHandler {
  const allowed = new Set(ctx.config.server.allowedHosts);
  return (req, _res, next) => {
    if (!allowed.has(hostName(req.headers.host))) {
      next(new ApiError(400, 'bad_host', 'This address is not the bag.'));
      return;
    }
    next();
  };
}

/**
 * CSRF (SYSTEM-ARCHITECTURE §9.5): every request that is not GET or HEAD must
 * carry `X-Sensebod-Offline-Client: 1`. A browser cannot add a custom header to a
 * cross-origin request without a preflight, and OPTIONS is never approved
 * here. When `Origin` is present it must be this host.
 */
export function csrf(): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    if (req.method === 'OPTIONS' || req.headers['x-sensebod-offline-client'] !== '1') {
      next(forbidden('csrf', 'This request did not come from the Sensebod Offline app.'));
      return;
    }
    const origin = req.headers.origin;
    // `Origin: null` (sandboxed frames, data: pages) is not this app either, so it is checked like any other value.
    if (typeof origin === 'string') {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = '';
      }
      if (originHost !== String(req.headers.host ?? '').toLowerCase()) {
        next(forbidden('csrf', 'This request did not come from the Sensebod Offline app.'));
        return;
      }
    }
    next();
  };
}

/** Read a small JSON body (≤ 1 MiB). Upload routes never use this: they stream the raw body to disk (R-1). */
export function jsonBody(limitBytes = 1024 * 1024): RequestHandler {
  return (req, _res, proceed) => {
    // Stream callbacks run outside the request's async context; put it back so the write gate still
    // counts its 5 s from the request's arrival (R-3a).
    const next = (error?: unknown): void => {
      requestStore.run({ arrivedAt: req.sb.arrivedAt }, () => (error === undefined ? proceed() : proceed(error)));
    };
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
      req.resume();
      next();
      return;
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limitBytes) {
      req.resume();
      next(tooLarge('This request is too large.'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limitBytes) {
        failed = true;
        chunks.length = 0;
        next(tooLarge('This request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      if (!failed) {
        failed = true;
        next(invalid('The request was cut off. Try again.'));
      }
    });
    req.on('end', () => {
      if (failed) return;
      if (size === 0) {
        next();
        return;
      }
      try {
        req.sb.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        next(invalid('The request had no readable content.'));
        return;
      }
      next();
    });
  };
}

export function sendJson(res: Response, status: number, body: unknown, cache: 'no-store' | 'no-cache' = 'no-store'): void {
  res.status(status);
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendNoContent(res: Response): void {
  res.status(204);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function sendError(res: Response, error: ApiError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error.headers) for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
  sendJson(res, error.status, error.body());
}

/**
 * Content answers (D-1.7): a weak ETag from the bag's content revision and the
 * path; `If-None-Match` is answered with 304 before any JSON is built.
 */
export function contentRoute(ctx: Ctx, build: (req: Request) => unknown): RequestHandler {
  return (req, res) => {
    // The revision alone is not enough: after a recovery or a restore it can repeat with other content, and a
    // new release can shape the same content differently. The epoch nonce and the version are part of the tag.
    const rev = ctx.meta('content_rev') ?? '0';
    const lineage = `${ctx.version}|${ctx.meta('epoch_nonce') ?? ''}|${req.originalUrl}`;
    const tag = `W/"c${rev}.${createHash('sha256').update(lineage).digest('hex').slice(0, 12)}"`;
    res.setHeader('ETag', tag);
    res.setHeader('Cache-Control', 'no-cache');
    const given = req.headers['if-none-match'];
    if (typeof given === 'string' && given.split(',').some((part) => part.trim() === tag)) {
      res.status(304).end();
      return;
    }
    sendJson(res, 200, build(req), 'no-cache');
  };
}

/** Turn anything thrown into the contract's error shape. Details of unexpected errors go to the log only. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  // Express reports a URL it cannot decode (e.g. "%E0%A4%A") with a URIError carrying status 400.
  if (error instanceof URIError || (error as { status?: number } | null)?.status === 400) return new ApiError(400, 'bad_request', 'This address is not readable.');
  if (error instanceof BusyError || error instanceof SqliteBusyError) return busy();
  if (error instanceof SqliteFullError) return storageFull(0, 0);
  if (error instanceof SqliteCorruptError) return maintenance();
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ENOSPC') return storageFull(0, 0);
  return new ApiError(500, 'internal', 'Something went wrong on the bag. Try again.');
}

export function errorHandler() {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const apiError = toApiError(error);
    if (apiError.status === 500) logError('error', error);
    // A full card or a damaged database must leave a trace for the technician, whatever the phone is told.
    else if (error instanceof SqliteFullError || error instanceof SqliteCorruptError) logError('error.storage', error, { kind: error instanceof SqliteFullError ? 'full' : 'corrupt' });
    else if ((error as { code?: string } | null)?.code === 'ENOSPC') logError('error.storage', error, { kind: 'full' });
    else if (error instanceof URIError) logError('error.request', new Error('malformed URL'));
    sendError(res, apiError);
  };
}

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(new ApiError(404, 'not_found', 'Unknown API path.'));
  };
}

/* ---- small readers for query values ---- */

export function queryString(req: Request, name: string): string | null {
  const value = req.query[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function queryInt(req: Request, name: string, fallback: number, max: number): number {
  const value = Number(queryString(req, name));
  return Number.isFinite(value) && value >= 1 ? Math.min(max, Math.floor(value)) : fallback;
}

export function paging(req: Request): { page: number; pageSize: number; offset: number } {
  const pageSize = queryInt(req, 'pageSize', 25, 100);
  const page = queryInt(req, 'page', 1, 100_000);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}
