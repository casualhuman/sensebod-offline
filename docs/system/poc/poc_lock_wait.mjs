// Throwaway PoC for V-026 (revision 3): lock waits and the Node event loop. Mac only (Node v23, node:sqlite,
// which is synchronous like better-sqlite3); not a Pi, so absolute times differ; the comparison is the point.
//
// Part 1 - event-loop freeze while the API process needs the write lock that another process holds for 1.5 s:
//   A  busy_timeout=5000, synchronous wait                  (v0.3 DATABASE §3 as written; the verifier's case)
//   B  busy_timeout=20 + asynchronous retry with backoff    (revision 3 BINDING DEFAULT, R-3a)
//   C  all writes in a worker_threads writer, busy_timeout=5000 inside the thread (allowed ALTERNATIVE, R-3b)
//   measured: max lag of a 5 ms interval timer in the API's main thread, and total time to the write.
// Part 2 - how long the OTHER writers of the design hold the write lock (they decide how long the API may wait):
//   job heartbeat/progress commit, learner progress commit, retention batch of 500 deletes, PASSIVE checkpoint,
//   TRUNCATE checkpoint attempted with busy_timeout=100 while a reader is open (must give up, not stall writers).
// Run: node poc_lock_wait.mjs   (creates and removes work_lock/ next to this file)
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = join(HERE, 'work_lock');
const DB = join(W, 'live.sqlite3');
const HOLD = 1500;

function open(busy) {
  const d = new DatabaseSync(DB);
  d.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=${busy};`);
  return d;
}

if (process.argv[2] === 'holder') {                // another writer (job child, maint, CLI) holding the lock
  const d = open(5000);
  d.exec('BEGIN IMMEDIATE'); d.exec("INSERT OR REPLACE INTO p VALUES('job', 1)");
  process.send('locked');                          // the transaction stays open (lock held) until the timer fires
  setTimeout(() => { d.exec('COMMIT'); d.close(); process.exit(0); }, Number(process.argv[3]));
} else {

function lagMeter() {
  let last = performance.now(), max = 0;
  const t = setInterval(() => { const now = performance.now(); max = Math.max(max, now - last - 5); last = now; }, 5);
  return () => { clearInterval(t); return max; };
}
function holder(ms) {
  return new Promise((resolve) => { const c = fork(fileURLToPath(import.meta.url), ['holder', String(ms)]); c.exited = new Promise((r) => c.on('exit', r)); c.on('message', () => resolve(c)); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function caseA() {
  const d = open(5000); const h = await holder(HOLD); const stop = lagMeter(); const t0 = performance.now();
  await sleep(10);
  d.exec('BEGIN IMMEDIATE'); d.exec("INSERT OR REPLACE INTO p VALUES('api', 1)"); d.exec('COMMIT');
  const total = performance.now() - t0; await sleep(20); const lag = stop(); d.close(); await h.exited;
  return `A busy_timeout=5000, synchronous wait: write after ${total.toFixed(0)} ms; max event-loop lag ${lag.toFixed(0)} ms`;
}

async function writeWithRetry(d, fn, { totalMs = 5000 } = {}) {   // R-3a: the binding default
  const start = performance.now(); let delay = 5, tries = 0;
  for (;;) {
    try { d.exec('BEGIN IMMEDIATE'); } catch (e) {
      if (!/locked|busy/i.test(String(e.message))) throw e;
      tries++;
      if (performance.now() - start + delay > totalMs) { const err = new Error('busy'); err.code = 'SQLITE_BUSY_TIMEOUT'; throw err; }
      await sleep(delay + Math.random() * delay * 0.2); delay = Math.min(delay * 2, 200); continue;
    }
    try { fn(); d.exec('COMMIT'); return tries; } catch (e) { d.exec('ROLLBACK'); throw e; }   // no await inside
  }
}

async function caseB() {
  const d = open(20); const h = await holder(HOLD); const stop = lagMeter(); const t0 = performance.now();
  await sleep(10);
  const tries = await writeWithRetry(d, () => d.exec("INSERT OR REPLACE INTO p VALUES('api', 2)"));
  const total = performance.now() - t0; await sleep(20); const lag = stop(); d.close(); await h.exited;
  // and the bounded total: a 7 s hold must end in 'busy' (-> 503) after about 5 s, without freezing
  const d2 = open(20); const h2 = await holder(7000); const stop2 = lagMeter(); const t1 = performance.now(); let outcome;
  try { await writeWithRetry(d2, () => d2.exec("INSERT OR REPLACE INTO p VALUES('api', 3)")); outcome = 'written (unexpected)'; }
  catch (e) { outcome = e.code; }
  const total2 = performance.now() - t1; const lag2 = stop2(); d2.close(); await h2.exited;
  return `B busy_timeout=20 + async retry/backoff: write after ${total.toFixed(0)} ms (${tries} retries); max event-loop lag ${lag.toFixed(0)} ms\n` +
         `  B with a 7 s hold: ${outcome} after ${total2.toFixed(0)} ms (cap 5 s -> API answers 503 busy); max event-loop lag ${lag2.toFixed(0)} ms`;
}

async function caseC() {
  const src = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(workerData);
    d.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    parentPort.on('message', (sql) => { d.exec('BEGIN IMMEDIATE'); d.exec(sql); d.exec('COMMIT'); parentPort.postMessage('ok'); });`;
  const w = new Worker(src, { eval: true, workerData: DB });
  const h = await holder(HOLD); const stop = lagMeter(); const t0 = performance.now(); await sleep(10);
  await new Promise((r) => { w.once('message', r); w.postMessage("INSERT OR REPLACE INTO p VALUES('api', 4)"); });
  const total = performance.now() - t0; await sleep(20); const lag = stop(); await w.terminate(); await h.exited;
  return `C writer in a worker thread (busy_timeout=5000 there): write after ${total.toFixed(0)} ms; max event-loop lag ${lag.toFixed(0)} ms`;
}

// Revision 3a (V-026): many requests waiting at once. Per-request retry with busy_timeout=20 lets every waiting
// request block the loop for up to 20 ms per attempt, and those blocks add up. The revision-3a BINDING DEFAULT is
// busy_timeout=0 plus a single-flight write gate: one in-process queue, only its head probes the lock (BEGIN
// IMMEDIATE, no wait inside SQLite), the others await their turn without touching SQLite.
async function storm(label, busy, gate, arrival) {
  const d = open(busy); const h = await holder(HOLD); const stop = lagMeter();
  let attempts = 0, chain = Promise.resolve(), n = 0, maxWait = 0;
  async function attemptLoop(i) {
    const start = performance.now(); let delay = 5;
    for (;;) {
      attempts++;
      try { d.exec('BEGIN IMMEDIATE'); } catch (e) {
        if (!/locked|busy/i.test(String(e.message))) throw e;
        if (performance.now() - start > 5000) throw new Error('busy');
        await sleep(delay + Math.random() * delay * 0.2); delay = Math.min(delay * 2, 200); continue;
      }
      d.exec(`INSERT OR REPLACE INTO p VALUES('r${i}', ${i})`); d.exec('COMMIT'); return;
    }
  }
  const write = (i) => {
    const t0 = performance.now();
    const run = gate ? (chain = chain.then(() => attemptLoop(i)).catch(() => {})) : attemptLoop(i);
    return run.then(() => { n++; maxWait = Math.max(maxWait, performance.now() - t0); });
  };
  const jobs = [];
  if (arrival === 'burst') for (let i = 0; i < 200; i++) jobs.push(write(i));
  else for (let i = 0; i < 60; i++) { jobs.push(write(1000 + i)); await sleep(25); }
  await Promise.all(jobs); const lag = stop(); d.close(); await h.exited;
  return `  ${label.padEnd(44)} ${arrival.padEnd(6)} writes=${n} attempts=${attempts} max wait=${maxWait.toFixed(0)} ms  max event-loop lag=${lag.toFixed(0)} ms`;
}

function holds() {
  const d = open(5000);
  d.exec(`CREATE TABLE IF NOT EXISTS job(id TEXT PRIMARY KEY, progress INT, heartbeat_at TEXT);
          CREATE TABLE IF NOT EXISTS progress(k TEXT PRIMARY KEY, state TEXT, seq INT);
          CREATE TABLE IF NOT EXISTS idem(k TEXT PRIMARY KEY, created_at INT);
          INSERT OR REPLACE INTO job VALUES('j1', 0, '');`);
  d.exec('BEGIN IMMEDIATE'); const ins = d.prepare('INSERT INTO idem VALUES(?, ?)');
  for (let i = 0; i < 20000; i++) ins.run('k' + i, i); d.exec('COMMIT');
  const time = (fn, n = 20) => { const xs = []; for (let i = 0; i < n; i++) { const t = performance.now(); fn(i); xs.push(performance.now() - t); }
    xs.sort((a, b) => a - b); return `median ${xs[Math.floor(n / 2)].toFixed(2)} ms, max ${xs[n - 1].toFixed(2)} ms`; };
  const out = [];
  out.push(`job heartbeat/progress commit: ${time((i) => { d.exec('BEGIN IMMEDIATE'); d.exec(`UPDATE job SET progress=${i}, heartbeat_at='t${i}' WHERE id='j1'`); d.exec('COMMIT'); })}`);
  out.push(`learner progress commit (with seq): ${time((i) => { d.exec('BEGIN IMMEDIATE'); d.exec(`INSERT OR REPLACE INTO progress VALUES('lr|l${i}', 'started', ${i})`); d.exec('COMMIT'); })}`);
  out.push(`retention batch, 500 deletes in one transaction: ${time((i) => { d.exec('BEGIN IMMEDIATE'); d.exec(`DELETE FROM idem WHERE rowid IN (SELECT rowid FROM idem ORDER BY created_at LIMIT 500)`); d.exec('COMMIT'); }, 20)}`);
  out.push(`PASSIVE checkpoint: ${time(() => d.prepare('PRAGMA wal_checkpoint(PASSIVE)').get(), 5)}`);
  const reader = open(5000); reader.exec('BEGIN'); reader.prepare('SELECT count(*) FROM idem').get();
  d.exec("INSERT OR REPLACE INTO job VALUES('j2', 0, '')");
  const m = open(100); const t = performance.now(); const r = m.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); const dt = performance.now() - t;
  out.push(`TRUNCATE checkpoint with busy_timeout=100 while a reader is open: returned busy=${r.busy} after ${dt.toFixed(0)} ms (gives up; writers wait at most that long)`);
  reader.exec('COMMIT'); reader.close(); m.close(); d.close();
  return out.map((x) => '  ' + x).join('\n');
}

rmSync(W, { recursive: true, force: true }); mkdirSync(W);
const s = new DatabaseSync(DB); s.exec("PRAGMA journal_mode=WAL; CREATE TABLE p(k TEXT PRIMARY KEY, v INT);"); s.close();
console.log('Part 1 - API event loop while another process holds the write lock for 1.5 s');
console.log(await caseA()); console.log(await caseB()); console.log(await caseC());
console.log('Part 1b - many concurrent writes while another process holds the lock for 1.5 s (revision 3a, V-026)');
for (const arrival of ['burst', 'steady']) {
  console.log(await storm('CONTROL busy_timeout=20, per-request retry', 20, false, arrival));
  console.log(await storm('busy_timeout=0, per-request retry', 0, false, arrival));
  console.log(await storm('DEFAULT busy_timeout=0 + single-flight gate', 0, true, arrival));
}
console.log('Part 2 - lock-hold durations of the other writers (synchronous=FULL; Mac fsync is not a full flush, so the Pi will be slower)');
console.log(holds());
rmSync(W, { recursive: true, force: true });
}
