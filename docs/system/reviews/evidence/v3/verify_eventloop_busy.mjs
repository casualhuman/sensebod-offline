// V3 check (OWNER-1, Node feasibility): does a synchronous SQLite write that waits on busy_timeout
// freeze the whole Node event loop (every other API request)?
// Uses Node's built-in synchronous driver node:sqlite (DatabaseSync) as a stand-in for any synchronous
// driver (better-sqlite3 behaves the same way: the call does not return until SQLite does).
// A second process (Python) holds BEGIN IMMEDIATE for HOLD ms, as a job child, the worker or
// sensebod-maint legitimately can (heartbeat/progress commits, retention batches, a checkpoint).
// Measured: max event-loop lag seen by a 5 ms timer while the API process does ONE progress write.
// Case A: busy_timeout=5000 (DATABASE §3, as specified).  Case B: busy_timeout=0 + async retry with setTimeout.
// Run: node verify_eventloop_busy.mjs   (Mac; Node v23; not a Pi)
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOLD = 1500;
const dir = mkdtempSync(join(process.cwd(), 'work_el_'));
const path = join(dir, 'live.sqlite3');
const setup = new DatabaseSync(path);
setup.exec("PRAGMA journal_mode=WAL; CREATE TABLE p(k TEXT PRIMARY KEY, v INT);");
setup.close();

function holder() {
  return new Promise((resolve) => {
    const py = spawn('python3', ['-I', '-c', `
import sqlite3, time, sys
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=5)
c.execute("BEGIN IMMEDIATE"); c.execute("INSERT OR REPLACE INTO p VALUES('job', 1)")
print("locked", flush=True); time.sleep(${HOLD}/1000); c.execute("COMMIT")`, path]);
    py.exited = new Promise((r) => py.on('exit', r));
    py.stdout.on('data', (d) => { if (String(d).includes('locked')) resolve(py); });
  });
}

async function measure(label, write) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  const py = await holder();
  let last = performance.now(), maxLag = 0, ticks = 0;
  const t = setInterval(() => { const n = performance.now(); maxLag = Math.max(maxLag, n - last - 5); last = n; ticks++; }, 5);
  await new Promise((r) => setTimeout(r, 50));
  const t0 = performance.now();
  const result = await write(db);
  const took = performance.now() - t0;
  await py.exited;
  await new Promise((r) => setTimeout(r, 50));
  clearInterval(t); db.close();
  console.log(`${label}: write ${result} after ${took.toFixed(0)} ms; max event-loop lag ${maxLag.toFixed(0)} ms (other requests frozen that long); timer ticks ${ticks}`);
}

await measure('A busy_timeout=5000 (as specified)', async (db) => {
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('BEGIN IMMEDIATE'); db.prepare("INSERT OR REPLACE INTO p VALUES('api', 1)").run(); db.exec('COMMIT');
  return 'ok';
});
await measure('B busy_timeout=0 + async retry every 20 ms', async (db) => {
  db.exec('PRAGMA busy_timeout=0');
  for (let i = 0; i < 400; i++) {
    try { db.exec('BEGIN IMMEDIATE'); db.prepare("INSERT OR REPLACE INTO p VALUES('api', 2)").run(); db.exec('COMMIT'); return `ok (after ${i} retries)`; }
    catch (e) { if (!/locked|busy/i.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 20)); }
  }
  return 'gave up';
});
rmSync(dir, { recursive: true, force: true });
