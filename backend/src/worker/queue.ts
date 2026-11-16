/* The job table as a queue (ADR-003): no broker; the worker claims rows with UPDATE … RETURNING. */
import type { Tx } from '../core/context.ts';
import { newId } from '../core/ids.ts';
import { nowIso } from '../core/time.ts';

export type Lane = 'media' | 'data' | 'usb';

export const MEDIA_KINDS = ['inspect', 'smaller_copy', 'voice_convert', 'pdf_pages', 'docx_text', 'package_check'];

export interface JobRow {
  id: string;
  kind: string;
  lane: Lane;
  state: 'queued' | 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled';
  payload_json: string;
  attempts: number;
  max_attempts: number;
  not_before: string | null;
  progress: number;
  boot_id: string | null;
  created_at: string;
}

/** Queue a job inside the transaction that makes it necessary. Data and USB jobs are never retried by themselves. */
export function enqueueJob(tx: Tx, kind: string, lane: Lane, payload: Record<string, unknown>): string {
  const id = newId('jb');
  tx.run(
    "INSERT INTO job (id, kind, lane, state, payload_json, attempts, max_attempts, progress, created_at) VALUES (?, ?, ?, 'queued', ?, 0, ?, 0, ?)",
    id,
    kind,
    lane,
    JSON.stringify(payload),
    lane === 'media' ? 3 : 1,
    nowIso(),
  );
  return id;
}

export function payloadOf<T>(job: { payload_json: string }): T {
  return JSON.parse(job.payload_json) as T;
}
