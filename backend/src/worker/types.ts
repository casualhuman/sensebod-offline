/*
 * The contract between the worker supervisor and a job (ADR-003, R-6).
 *
 * `run` executes in the job's OWN child process: a crash in a tool or an
 * out-of-memory kill ends the job, never the worker. It does the slow work
 * (hashing, ffmpeg, zip, tar, the stick) and returns a plain result. It may
 * open the database to read what it needs or to take a snapshot, and closes
 * it before any long file or stick work (V-024).
 *
 * `finalize` executes in the supervisor, inside ONE short write transaction:
 * it records the result. The order is always: file durable → rename →
 * directory durable → (child reports) → row committed.
 */
import type { Config, Paths } from '../config.ts';
import type { Ctx, Tx } from '../core/context.ts';
import type { JobRow, Lane } from './queue.ts';

export class JobFailure extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.code = code;
  }
}

export interface JobEnv {
  config: Config;
  paths: Paths;
  job: { id: string; kind: string; payload: Record<string, unknown> };
  /** A private scratch folder under jobs/tmp/, removed when the job ends, whatever the outcome. */
  workDir: string;
  /** 0–100. Forwarded to the supervisor, which writes it at most every 2 s. Every call also counts as a heartbeat. */
  progress(percent: number): void;
}

/** Runs after the transaction committed (e.g. removing a file that is no longer needed). */
export type AfterCommit = (() => void) | void;

export interface Handler {
  lane: Lane;
  run(env: JobEnv): Promise<unknown>;
  finalize(ctx: Ctx, tx: Tx, job: JobRow, result: unknown): AfterCommit;
  /**
   * The job ended without a result. `final` is false when a media job will be tried again.
   * State changes of the things the job was for (upload, export) happen here.
   */
  failed(ctx: Ctx, tx: Tx, job: JobRow, state: 'failed' | 'interrupted', code: string, final: boolean): AfterCommit;
}
