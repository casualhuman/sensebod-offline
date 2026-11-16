/*
 * Idempotency for create-type POSTs (SYSTEM-ARCHITECTURE §5.1, D-1.9).
 *
 * Keys are kept 24 h, scoped by actor. The stored answer is written in the
 * SAME transaction as the change it describes, so after a power cut either
 * both exist or neither. One-time secrets are never stored: the caller passes
 * a separate `stored` body for replays (V-004).
 *
 *   same key, same request, finished  → the stored status and body again
 *   same key, different request       → 422 idempotency_mismatch
 *   same key, first one still running → 409 in_progress, Retry-After: 2
 */
import type { Request } from 'express';
import type { Ctx, Tx } from './context.ts';
import { ApiError, invalid } from './errors.ts';
import { sha256Hex } from './ids.ts';
import { nowIso } from './time.ts';

export interface Outcome {
  status: number;
  body: unknown;
  /** What a replay answers instead of `body` (e.g. without a one-time password). */
  stored?: unknown;
}

interface RecordRow {
  method: string;
  path: string;
  request_sha256: string;
  state: 'in_progress' | 'done';
  status_code: number | null;
  response_json: string | null;
}

/** Keys this process is working on now. An `in_progress` row that is not here was left by a crash and may be taken over. */
const running = new Set<string>();

function keyOf(req: Request, required: boolean): string | null {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || value === '') {
    if (required) throw invalid('This request needs an Idempotency-Key.', { 'Idempotency-Key': 'Send a key of 8 to 128 characters.' });
    return null;
  }
  if (value.length < 8 || value.length > 128) throw invalid('The Idempotency-Key must be 8 to 128 characters.', { 'Idempotency-Key': 'Use 8 to 128 characters.' });
  return value;
}

function pathOf(req: Request): string {
  return req.baseUrl + req.path;
}

function replay(row: RecordRow): Outcome {
  return { status: row.status_code ?? 200, body: row.response_json === null ? null : JSON.parse(row.response_json) };
}

function look(tx: Tx, scope: string, key: string, req: Request, requestHash: string): Outcome | 'new' {
  const row = tx.get<RecordRow>('SELECT method, path, request_sha256, state, status_code, response_json FROM idempotency_record WHERE scope = ? AND key = ?', scope, key);
  if (!row) return 'new';
  if (row.method !== req.method || row.path !== pathOf(req) || row.request_sha256 !== requestHash) {
    throw new ApiError(422, 'idempotency_mismatch', 'This request was already sent with different content.');
  }
  if (row.state === 'done') return replay(row);
  if (running.has(`${scope}\n${key}`)) {
    throw new ApiError(409, 'in_progress', 'This request is still being worked on.', { headers: { 'Retry-After': '2' } });
  }
  // Left behind by a process that died before finishing: start again.
  tx.run('DELETE FROM idempotency_record WHERE scope = ? AND key = ?', scope, key);
  return 'new';
}

function store(tx: Tx, scope: string, key: string, req: Request, requestHash: string, outcome: Outcome | null): void {
  tx.run(
    `INSERT INTO idempotency_record (scope, key, method, path, request_sha256, state, status_code, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, key) DO UPDATE SET state = excluded.state, status_code = excluded.status_code, response_json = excluded.response_json`,
    scope,
    key,
    req.method,
    pathOf(req),
    requestHash,
    outcome ? 'done' : 'in_progress',
    outcome ? outcome.status : null,
    outcome ? JSON.stringify(outcome.stored === undefined ? outcome.body : outcome.stored) : null,
    nowIso(),
  );
}

export interface IdemOptions {
  scope: string;
  required: boolean;
  /** What identifies the request besides method and path. Defaults to the JSON body. */
  fingerprint?: string;
}

function hashOf(req: Request, options: IdemOptions): string {
  return sha256Hex(options.fingerprint ?? JSON.stringify(req.sb.body ?? null));
}

/**
 * A create whose whole work is one transaction: look up the key, do the work
 * and store the answer atomically. Without a key (where it is optional) the
 * work simply runs.
 */
export async function idempotent(ctx: Ctx, req: Request, options: IdemOptions, work: (tx: Tx) => Outcome): Promise<Outcome> {
  const key = keyOf(req, options.required);
  if (key === null) return ctx.write(work);
  const requestHash = hashOf(req, options);
  return ctx.write((tx) => {
    const seen = look(tx, options.scope, key, req, requestHash);
    if (seen !== 'new') return seen;
    const outcome = work(tx);
    store(tx, options.scope, key, req, requestHash, outcome);
    return outcome;
  });
}

export interface Slot {
  /** Set when the key was seen before: answer this and do nothing else. */
  replay: Outcome | null;
  /** Call inside the transaction that makes the change. */
  complete(tx: Tx, outcome: Outcome): void;
  /** Call when the work failed, so a retry with the same key starts again. */
  abort(): Promise<void>;
}

/**
 * A create that needs asynchronous work (hashing, streaming a file) between
 * the first look and the final transaction.
 */
export async function beginIdempotent(ctx: Ctx, req: Request, options: IdemOptions): Promise<Slot> {
  const key = keyOf(req, options.required);
  if (key === null) return { replay: null, complete: () => undefined, abort: async () => undefined };
  const requestHash = hashOf(req, options);
  const mark = `${options.scope}\n${key}`;
  const seen = await ctx.write((tx) => {
    const found = look(tx, options.scope, key, req, requestHash);
    if (found === 'new') store(tx, options.scope, key, req, requestHash, null);
    return found;
  });
  if (seen !== 'new') return { replay: seen, complete: () => undefined, abort: async () => undefined };
  running.add(mark);
  return {
    replay: null,
    complete(tx, outcome) {
      store(tx, options.scope, key, req, requestHash, outcome);
      running.delete(mark);
    },
    async abort() {
      running.delete(mark);
      await ctx.write((tx) => tx.run("DELETE FROM idempotency_record WHERE scope = ? AND key = ? AND state = 'in_progress'", options.scope, key)).catch(() => undefined);
    },
  };
}

export function actorScope(req: Request): string {
  return req.sb.admin ? `admin:${req.sb.admin.id}` : 'anon';
}
