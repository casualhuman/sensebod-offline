/*
 * The worker supervisor (SYSTEM-ARCHITECTURE §5.8, ADR-003): one process,
 * three lanes (media, data, usb), each running one job at a time in its own
 * child process.
 *
 * - Claim: UPDATE … WHERE state = 'queued' … RETURNING, one short transaction.
 * - Progress and heartbeat: one-row commits, at most every 2 s (R-3H).
 * - Stall: no sign of life for the lane's limit → SIGTERM, SIGKILL after 20 s,
 *   job failed/stalled. A child that cannot be killed (uninterruptible I/O on
 *   a dead stick) is given up: its job is failed anyway and the usb lane
 *   stops taking jobs until the stick is gone; the other lanes carry on.
 * - Worker-start recovery on EVERY start: a job still `running` is an orphan
 *   (there is one worker): data/usb → interrupted/worker_restart, media → queued.
 * - Media jobs are retried (3 attempts, 1 min then 5 min); data and usb jobs never.
 * - SIGTERM: children get SIGTERM, media jobs go back to queued, data/usb
 *   jobs become interrupted; exit within 20 s.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ctx, Tx } from '../core/context.ts';
import { removeQuietly } from '../core/fsx.ts';
import { log, logError } from '../core/log.ts';
import { MINUTE, nowIso } from '../core/time.ts';
import type { JobRow, Lane } from './queue.ts';
import { handlerFor } from './registry.ts';

const LANES: Lane[] = ['media', 'data', 'usb'];
const STALL_MS: Record<Lane, number> = { media: 15 * MINUTE, data: 10 * MINUTE, usb: 5 * MINUTE };
const RETRY_AFTER_MS = [MINUTE, 5 * MINUTE];
const PROGRESS_EVERY_MS = 2000;
const KILL_AFTER_MS = 20_000;
const POLL_MS = 2000;
const HOT_C = 80;
const NO_RETRY = ['gone', 'unsupported', 'not_a_package', 'unsafe_package', 'tool_missing', 'bad_file', 'file_lost', 'not_built'];

interface Running {
  job: JobRow;
  child: ChildProcess;
  lastSignOfLife: number;
  lastWrite: number;
  progress: number;
  settled: boolean;
  termSentAt: number | null;
}

export interface SupervisorOptions {
  /** Extra argv for job children (the --config path). */
  childArgv: string[];
  pollMs?: number;
}

function runnerPath(): string {
  return fileURLToPath(import.meta.url).replace(/supervisor\.(ts|js)$/, 'runner.$1');
}

function cpuTemperature(): number | null {
  try {
    return Number(readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim()) / 1000;
  } catch {
    return null;
  }
}

/** Signal the job process and everything it started. */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

export class Supervisor {
  private readonly ctx: Ctx;
  private readonly options: SupervisorOptions;
  private readonly running = new Map<Lane, Running>();
  private readonly timers: NodeJS.Timeout[] = [];
  private stopping = false;
  /** A usb child that could not be killed: no more usb jobs until the stick is gone. */
  private usbStuck = false;
  private unsettled: (() => void)[] = [];

  constructor(ctx: Ctx, options: SupervisorOptions) {
    this.ctx = ctx;
    this.options = options;
  }

  /** Worker-start recovery, then the lanes start claiming. */
  start(): void {
    this.recover();
    for (const lane of LANES) {
      const timer = setInterval(() => this.tick(lane), this.options.pollMs ?? POLL_MS);
      this.timers.push(timer);
      this.tick(lane);
    }
  }

  private setStuck(value: boolean): void {
    this.usbStuck = value;
    try {
      this.ctx.writeSync((tx) =>
        tx.run(
          "INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES ('usb.lane_stuck', ?, ?, 'system') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
          value ? 'true' : 'false',
          nowIso(),
        ),
      );
    } catch (error) {
      logError('worker.setting', error);
    }
  }

  /** DATA-EXPORT §13, "when the worker starts". */
  recover(): void {
    const cleanups: (() => void)[] = [];
    this.ctx.writeSync((tx) => {
      const orphans = tx.all<JobRow>("SELECT * FROM job WHERE state = 'running'");
      for (const job of orphans) cleanups.push(...this.giveUp(tx, job, 'interrupted', 'worker_restart', true));
    });
    for (const cleanup of cleanups) cleanup();
    this.setStuck(false);
    log('worker.start', { lanes: LANES.length });
  }

  /**
   * End a job that produced no result. Media jobs go back to the queue while
   * they have attempts left; everything else ends in `state`.
   */
  private giveUp(tx: Tx, job: JobRow, state: 'failed' | 'interrupted', code: string, requeueNow: boolean): (() => void)[] {
    const handler = handlerFor(job.lane, job.kind);
    const cleanups: (() => void)[] = [() => removeQuietly(`${this.ctx.paths.jobsTmp}/${job.id}`)];
    // Trying again cannot help when the file itself is the problem.
    const retry = job.lane === 'media' && NO_RETRY.indexOf(code) === -1 && (requeueNow || job.attempts < job.max_attempts);
    if (retry) {
      const wait = requeueNow ? 0 : (RETRY_AFTER_MS[Math.min(job.attempts, RETRY_AFTER_MS.length) - 1] ?? 5 * MINUTE);
      // A job cut off by a restart of the worker did not use up one of its attempts.
      tx.run(
        "UPDATE job SET state = 'queued', not_before = ?, error_code = ?, heartbeat_at = NULL, attempts = max(0, attempts - ?) WHERE id = ?",
        wait > 0 ? new Date(Date.now() + wait).toISOString() : null,
        code,
        requeueNow ? 1 : 0,
        job.id,
      );
      const after = handler?.failed(this.ctx, tx, job, state, code, false);
      if (after) cleanups.push(after);
      return cleanups;
    }
    // A media job has no "interrupted": out of attempts, it failed.
    const finalState = job.lane === 'media' ? 'failed' : state;
    tx.run('UPDATE job SET state = ?, finished_at = ?, error_code = ? WHERE id = ?', finalState, nowIso(), code, job.id);
    const after = handler?.failed(this.ctx, tx, job, finalState, code, true);
    if (after) cleanups.push(after);
    return cleanups;
  }

  private tick(lane: Lane): void {
    if (this.stopping) return;
    try {
      // A job whose ending could not be written (database busy or full) must not stay `running` for ever:
      // it would block new exports. The write is tried again until it goes through.
      if (this.unsettled.length > 0) {
        const pending = this.unsettled;
        this.unsettled = [];
        for (const settle of pending) settle();
      }
      const current = this.running.get(lane);
      if (current) {
        this.watch(lane, current);
        return;
      }
      if (lane === 'usb' && this.usbStuck) {
        // Taking the stick out (or putting it back) frees the lane.
        if (!existsSync(this.ctx.paths.usbJson) || !existsSync(this.ctx.paths.usbMount)) this.setStuck(false);
        return;
      }
      // Conversions wait while the Pi is hot; learners' requests come first.
      if (lane === 'media' && (cpuTemperature() ?? 0) >= HOT_C) return;
      const job = this.claim(lane);
      if (job) this.launch(lane, job);
    } catch (error) {
      logError('worker.tick', error, { lane });
    }
  }

  private claim(lane: Lane): JobRow | null {
    const now = nowIso();
    return (
      this.ctx.writeSync((tx) =>
        tx.get<JobRow>(
          `UPDATE job SET state = 'running', boot_id = ?, attempts = attempts + 1, started_at = ?, heartbeat_at = ?, progress = 0, error_code = NULL
            WHERE id = (SELECT id FROM job WHERE lane = ? AND state = 'queued' AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at, id LIMIT 1)
              AND state = 'queued'
        RETURNING *`,
          this.ctx.boot.bootId,
          now,
          now,
          lane,
          now,
        ),
      ) ?? null
    );
  }

  private launch(lane: Lane, job: JobRow): void {
    // Its own process group, so a stalled job is stopped together with the tools it started (ffmpeg, age).
    const child = fork(runnerPath(), ['--job', job.id, ...this.options.childArgv], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: process.execArgv, detached: true });
    const now = performance.now();
    const entry: Running = { job, child, lastSignOfLife: now, lastWrite: now, progress: 0, settled: false, termSentAt: null };
    this.running.set(lane, entry);
    log('job.start', { job: job.id, kind: job.kind, lane, attempt: job.attempts });

    child.on('message', (message: { t?: string; p?: number; result?: unknown; code?: string }) => {
      entry.lastSignOfLife = performance.now();
      if (message.t === 'progress' && typeof message.p === 'number') {
        entry.progress = message.p;
        this.writeProgress(entry, false);
      } else if (message.t === 'done') {
        this.finish(lane, entry, message.result);
      } else if (message.t === 'fail') {
        this.fail(lane, entry, 'failed', typeof message.code === 'string' ? message.code : 'internal');
      }
    });
    child.on('exit', (code, signal) => {
      // No result and no understood failure: the child crashed or was killed (out of memory, a tool bug).
      if (!entry.settled) this.fail(lane, entry, 'failed', signal === 'SIGKILL' || signal === 'SIGTERM' ? 'stalled' : 'internal', { code, signal });
      if (this.running.get(lane) === entry) this.running.delete(lane);
      if (!this.stopping) setImmediate(() => this.tick(lane));
    });
    child.on('error', (error) => logError('job.child', error, { job: job.id }));
  }

  /** One-row commit, at most every 2 s; at least every 30 s it is written as a heartbeat even without change. */
  private writeProgress(entry: Running, force: boolean): void {
    const now = performance.now();
    if (!force && now - entry.lastWrite < PROGRESS_EVERY_MS) return;
    entry.lastWrite = now;
    try {
      this.ctx.writeSync((tx) => tx.run("UPDATE job SET progress = ?, heartbeat_at = ? WHERE id = ? AND state = 'running'", entry.progress, nowIso(), entry.job.id));
    } catch (error) {
      logError('job.progress', error, { job: entry.job.id });
    }
  }

  private watch(lane: Lane, entry: Running): void {
    const now = performance.now();
    if (entry.termSentAt !== null) {
      if (now - entry.termSentAt > KILL_AFTER_MS && !entry.child.killed) killTree(entry.child, 'SIGKILL');
      if (now - entry.termSentAt > 2 * KILL_AFTER_MS && this.running.get(lane) === entry) {
        // It will not die: uninterruptible I/O on a dead stick. The lane stops; the job is already failed.
        this.running.delete(lane);
        if (lane === 'usb') this.setStuck(true);
        log('job.unkillable', { job: entry.job.id, lane });
      }
      return;
    }
    if (now - entry.lastSignOfLife > STALL_MS[lane]) {
      log('job.stalled', { job: entry.job.id, lane });
      this.fail(lane, entry, 'failed', 'stalled');
      entry.termSentAt = now;
      killTree(entry.child, 'SIGTERM');
      return;
    }
    if (now - entry.lastWrite > 30_000) this.writeProgress(entry, true);
  }

  private finish(lane: Lane, entry: Running, result: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    const handler = handlerFor(entry.job.lane, entry.job.kind);
    let after: (() => void) | void;
    try {
      after = this.ctx.writeSync((tx) => {
        const done = handler?.finalize(this.ctx, tx, entry.job, result);
        tx.run("UPDATE job SET state = 'done', progress = 100, finished_at = ?, heartbeat_at = ?, error_code = NULL WHERE id = ?", nowIso(), nowIso(), entry.job.id);
        return done;
      });
    } catch (error) {
      logError('job.finalize', error, { job: entry.job.id });
      entry.settled = false;
      this.fail(lane, entry, 'failed', 'internal');
      return;
    }
    if (after) after();
    log('job.done', { job: entry.job.id, kind: entry.job.kind, lane });
  }

  private fail(lane: Lane, entry: Running, state: 'failed' | 'interrupted', code: string, detail: Record<string, unknown> = {}): void {
    if (entry.settled) return;
    entry.settled = true;
    const settle = (): void => {
      try {
        const cleanups = this.ctx.writeSync((tx) => {
          // Only a job that is still marked running is settled (a retry must not undo a later state).
          if (!tx.get("SELECT 1 FROM job WHERE id = ? AND state = 'running'", entry.job.id)) return [];
          return this.giveUp(tx, entry.job, state, code, state === 'interrupted');
        });
        for (const cleanup of cleanups) cleanup();
      } catch (error) {
        logError('job.fail', error, { job: entry.job.id });
        this.unsettled.push(settle);
      }
    };
    settle();
    log('job.failed', { job: entry.job.id, kind: entry.job.kind, lane, state, code, ...detail });
  }

  /** Shutdown: children are told to stop, their jobs are settled, and the worker leaves within 20 s. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    const waits: Promise<void>[] = [];
    for (const [lane, entry] of this.running) {
      // Media work is repeatable: back to the queue. A data or usb job is not retried: interrupted.
      this.fail(lane, entry, 'interrupted', 'worker_restart');
      waits.push(new Promise((resolve) => entry.child.once('exit', () => resolve())));
      killTree(entry.child, 'SIGTERM');
    }
    await Promise.race([Promise.all(waits), new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref())]);
    for (const entry of this.running.values()) if (!entry.child.killed && entry.child.exitCode === null) killTree(entry.child, 'SIGKILL');
  }

  /** For tests: how many jobs are running now. */
  activeCount(): number {
    return this.running.size;
  }
}
