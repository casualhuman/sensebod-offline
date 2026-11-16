// V4: the R-3a asynchronous retry under many waiting requests (DB-6's injected 1.5 s hold by another process).
// Each failed BEGIN IMMEDIATE still waits busy_timeout SYNCHRONOUSLY before failing, so N attempts that run in the
// same tick stack up. Variants:
//   R-3a as written: busy_timeout=20, every waiting request retries on its own timer (5,10,20..200 ms, +-20 %).
//   busy_timeout=0: same retry loop, a failed attempt costs ~0 ms.
//   single-flight gate: busy_timeout=20, but only one request at a time probes the lock; the rest wait in an
//     in-process FIFO (promises), so at most one synchronous 20 ms wait per backoff step.
// Arrival patterns: (burst) 200 writes in one tick; (steady) 40 writes/s for the 1.5 s hold.
// Mac, Node v23, node:sqlite as a synchronous stand-in. Run: node --no-warnings verify_retry_storm.mjs
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

async function trial(label, busy, gate, arrival) {
  const dir = mkdtempSync(join(process.cwd(), 'work_storm_')), path = join(dir, 'live.sqlite3');
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=${busy}; CREATE TABLE p(k TEXT PRIMARY KEY, v INT)`);
  const stmt = db.prepare('INSERT OR REPLACE INTO p VALUES(?, ?)');
  const py = spawn('python3', ['-I', '-c', `
import sqlite3, time, sys
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=5)
c.execute("BEGIN IMMEDIATE"); c.execute("INSERT OR REPLACE INTO p VALUES('hold', 1)")
print("locked", flush=True); time.sleep(1.5); c.execute("COMMIT")`, path]);
  const exited = new Promise((r) => py.on('exit', r));
  await new Promise((r) => py.stdout.on('data', (d) => String(d).includes('locked') && r()));
  let attempts = 0, chain = Promise.resolve();
  async function attemptLoop(fn) {
    const t0 = performance.now(); let step = 5;
    for (;;) {
      attempts++;
      try { db.exec('BEGIN IMMEDIATE'); fn(); db.exec('COMMIT'); return performance.now() - t0; }
      catch (e) {
        if (!/locked|busy/i.test(String(e.message))) throw e;
        if (performance.now() - t0 > 5000) throw new Error('503 busy');
        await new Promise((r) => setTimeout(r, step * (0.8 + 0.4 * Math.random()))); step = Math.min(step * 2, 200);
      }
    }
  }
  const write = gate ? (fn) => { const t0 = performance.now(); const p = chain.then(() => attemptLoop(fn)).then(() => performance.now() - t0); chain = p.catch(() => {}); return p; }
                     : attemptLoop;
  let last = performance.now(), maxLag = 0;
  const timer = setInterval(() => { const n = performance.now(); maxLag = Math.max(maxLag, n - last - 5); last = n; }, 5);
  const jobs = [];
  if (arrival === 'burst') for (let i = 0; i < 200; i++) jobs.push(write(() => stmt.run('lr-' + i, i)));
  else for (let i = 0; i < 60; i++) { jobs.push(write(() => stmt.run('lr-' + i, i))); await new Promise((r) => setTimeout(r, 25)); }
  const res = await Promise.allSettled(jobs);
  clearInterval(timer); await exited; db.close(); rmSync(dir, { recursive: true, force: true });
  const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value).sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} ${arrival.padEnd(6)} n=${res.length} ok=${ok.length} attempts=${attempts} max wait=${ok.length ? ok[ok.length - 1].toFixed(0) : '-'} ms  max event-loop lag=${maxLag.toFixed(0)} ms`);
}
for (const arrival of ['burst', 'steady']) {
  await trial('R-3a as written (busy_timeout=20, per-request)', 20, false, arrival);
  await trial('busy_timeout=0, per-request retry', 0, false, arrival);
  await trial('busy_timeout=20 + single-flight gate', 20, true, arrival);
}
