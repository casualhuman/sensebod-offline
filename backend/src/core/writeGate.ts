/*
 * The single-flight write gate of the API process (R-3L / R-3a, DATABASE §4.5).
 *
 * All API writes go through one promise queue. Only the request at the head
 * touches SQLite: it tries BEGIN IMMEDIATE on a connection with
 * busy_timeout=0 and, when another process holds the write lock, retries
 * asynchronously with timer backoff (5, 10, 20 … ms, at most 200 ms per step,
 * ±20 % jitter). The requests behind it wait in the queue without touching
 * SQLite, so a lock wait never blocks the event loop. Each request waits at
 * most 5 s counted from its arrival (queue time included), then fails with
 * BusyError, which the error handler turns into `503 busy`, Retry-After: 2.
 */
import { Db, SqliteBusyError } from './db.ts';

export class BusyError extends Error {
  constructor() {
    super('The bag is busy. Try again in a moment.');
  }
}

export interface GateStats {
  runs: number;
  lockAttempts: number;
  busyRetries: number;
  rejected: number;
  maxWaitMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WriteGate {
  readonly db: Db;
  readonly totalWaitMs: number;
  readonly stats: GateStats = { runs: 0, lockAttempts: 0, busyRetries: 0, rejected: 0, maxWaitMs: 0 };
  private tail: Promise<unknown> = Promise.resolve();

  constructor(db: Db, totalWaitMs = 5000) {
    this.db = db;
    this.totalWaitMs = totalWaitMs;
  }

  /**
   * Run `fn` inside one BEGIN IMMEDIATE transaction, after every write queued
   * before it. `arrivedAt` is the request's arrival time (performance.now()).
   */
  run<T>(fn: () => T, options: { arrivedAt?: number; secureDelete?: boolean } = {}): Promise<T> {
    const arrivedAt = options.arrivedAt ?? performance.now();
    const turn = this.tail.then(() => this.head(fn, arrivedAt, options.secureDelete === true));
    // The queue must keep moving whatever happens to this entry.
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  private async head<T>(fn: () => T, arrivedAt: number, secureDelete: boolean): Promise<T> {
    const deadline = arrivedAt + this.totalWaitMs;
    let delay = 5;
    for (;;) {
      if (performance.now() > deadline) {
        this.stats.rejected += 1;
        throw new BusyError();
      }
      this.stats.lockAttempts += 1;
      try {
        const result = this.db.tx(fn, { secureDelete });
        this.stats.runs += 1;
        this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, performance.now() - arrivedAt);
        return result;
      } catch (error) {
        // BUSY can only come from BEGIN IMMEDIATE (the lock is ours after it), so `fn` has not run.
        if (!(error instanceof SqliteBusyError)) throw error;
      }
      this.stats.busyRetries += 1;
      const jittered = delay * (0.8 + Math.random() * 0.4);
      const left = deadline - performance.now();
      if (left <= 0) {
        this.stats.rejected += 1;
        throw new BusyError();
      }
      await sleep(Math.min(jittered, left));
      delay = Math.min(200, delay * 2);
    }
  }
}

/** Reads stay outside the gate; on the rare SQLITE_BUSY they retry asynchronously (R-3a). */
export async function readWithRetry<T>(fn: () => T, arrivedAt = performance.now(), totalWaitMs = 5000): Promise<T> {
  let delay = 5;
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof SqliteBusyError)) throw error;
    }
    if (performance.now() + delay > arrivedAt + totalWaitMs) throw new BusyError();
    await sleep(delay * (0.8 + Math.random() * 0.4));
    delay = Math.min(200, delay * 2);
  }
}
