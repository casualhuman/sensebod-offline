/* BE-1…BE-3: configuration, schema conformance (DB-3), the write gate (DB-6 on a laptop), core HTTP rules (SEC-2), log redaction (SEC-7). */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildConfig, ConfigError } from '../src/config.ts';
import { Db, SqliteBusyError } from '../src/core/db.ts';
import { crockford, newId, normaliseCode, random128 } from '../src/core/ids.ts';
import { log, redact, redactionCount, setSensitiveLessonIds } from '../src/core/log.ts';
import { listMigrations, migrate } from '../src/core/migrate.ts';
import { liftEpoch, readEpochFloor, replaceLiveDatabase } from '../src/core/replace.ts';
import { BusyError, WriteGate } from '../src/core/writeGate.ts';
import { vacuumInto } from '../src/exports/snapshots.ts';
import { Client, makeBag, rawGet, sleep, type Bag } from './harness.ts';

const DOC = readFileSync(new URL('../../docs/system/DATABASE.md', import.meta.url), 'utf8');

function ddl(begin: string, end: string): string {
  const block = DOC.split(`<!-- ${begin} -->`)[1]?.split(`<!-- ${end} -->`)[0] ?? '';
  return block.split('```sql')[1]?.split('```')[0] ?? '';
}

/** name → normalised CREATE statement, for every table and index. */
function shape(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string; sql: string }[];
  return new Map(rows.map((r) => [r.name, r.sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()]));
}

describe('configuration (R-7)', () => {
  test('unknown tables and keys stop the start', () => {
    assert.throws(() => buildConfig({ nonsense: {} }), ConfigError);
    assert.throws(() => buildConfig({ server: { prot: 1 } }), ConfigError);
    assert.throws(() => buildConfig({ child_protection: { progress_mode: 'everything' } }), ConfigError);
    assert.throws(() => buildConfig({ server: { port: 'eighty' } }), ConfigError);
  });
  test('defaults follow the owner decisions', () => {
    const config = buildConfig({});
    assert.equal(config.childProtection.progressMode, 'counts-only');
    assert.equal(config.retention.learnerDays, 61);
    assert.equal(config.retention.unexportedHoldDays, 60, 'O-16: unexported data is held 60 extra days');
    assert.equal(config.server.host, '127.0.0.1');
  });
  test('[dev] switches are refused unless the process was started for development', () => {
    const saved = process.env.SENSEBOD_OFFLINE_DEV;
    delete process.env.SENSEBOD_OFFLINE_DEV;
    try {
      assert.throws(() => buildConfig({ dev: { serve_files: true } }), /laptops only/);
      assert.doesNotThrow(() => buildConfig({ dev: { serve_files: false } }));
    } finally {
      process.env.SENSEBOD_OFFLINE_DEV = saved;
    }
  });
});

describe('schema conformance (BE-2, DB-3)', () => {
  test('the migrated databases are exactly the DDL of DATABASE.md §6', () => {
    for (const [which, begin, end] of [['main', 'DDL-BEGIN', 'DDL-END'], ['counts', 'COUNTS-DDL-BEGIN', 'COUNTS-DDL-END']] as const) {
      const fromDoc = new DatabaseSync(':memory:');
      fromDoc.exec(ddl(begin, end));
      const dir = mkdtempSync(join(os.tmpdir(), 'sb-schema-'));
      const db = new Db(join(dir, 'x.sqlite3'), { role: 'batch', skipWalAssert: true });
      db.exec('PRAGMA journal_mode=WAL');
      assert.deepEqual(migrate(db, which), listMigrations(which).map((m) => m.id));
      assert.deepEqual(migrate(db, which), [], 'running the runner again applies nothing');
      const want = shape(fromDoc);
      const got = shape(db.raw);
      assert.deepEqual([...got.keys()], [...want.keys()], `${which}: same tables and indexes`);
      for (const [name, sql] of want) assert.equal(got.get(name), sql, `${which}.${name}`);
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('a migration that was changed after it was applied is refused', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'sb-schema-'));
    const db = new Db(join(dir, 'x.sqlite3'), { role: 'batch', skipWalAssert: true });
    migrate(db, 'counts');
    db.run("UPDATE schema_migrations SET checksum = 'tampered'");
    assert.throws(() => migrate(db, 'counts'), /changed after it was applied/);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('ids (ADR-016)', () => {
  test('128 random bits as 26 base32 characters, with a prefix', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(newId('lr'));
    assert.equal(seen.size, 2000);
    for (const id of seen) assert.match(id, /^lr-[a-z2-7]{26}$/);
    assert.match(random128(), /^[a-z2-7]{26}$/);
  });
  test('Crockford codes are read tolerantly', () => {
    assert.equal(crockford(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]), 8), 'ZZZZZZZZ');
    assert.equal(normaliseCode('wb0de-d5f56'), 'WB0DED5F56');
    assert.equal(normaliseCode('O0-Il1 o'), '001110');
  });
});

describe('write gate (R-3L / R-3a)', () => {
  let dir = '';
  let file = '';
  before(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'sb-gate-'));
    file = join(dir, 'g.sqlite3');
    const db = new Db(file, { role: 'batch', skipWalAssert: true });
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.close();
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('while another connection holds the lock, writes wait in the queue and the event loop keeps turning', async () => {
    const api = new Db(file, { role: 'api' });
    const holder = new Db(file, { role: 'batch' });
    const gate = new WriteGate(api);
    holder.exec('BEGIN IMMEDIATE');
    holder.run("INSERT INTO t (v) VALUES ('holder')");
    setTimeout(() => holder.exec('COMMIT'), 400);
    let maxLag = 0;
    let last = performance.now();
    const meter = setInterval(() => {
      const now = performance.now();
      maxLag = Math.max(maxLag, now - last - 5);
      last = now;
    }, 5);
    const order: number[] = [];
    await Promise.all(Array.from({ length: 100 }, (_, i) => gate.run(() => void (order.push(i), api.run('INSERT INTO t (v) VALUES (?)', `w${i}`)))));
    clearInterval(meter);
    assert.deepEqual(order, Array.from({ length: 100 }, (_, i) => i), 'first in, first out');
    assert.equal(api.value('SELECT count(*) FROM t'), 101);
    assert.ok(gate.stats.busyRetries >= 1, 'the head retried while the lock was held');
    // Only the head of the queue touches SQLite: far fewer lock attempts than waiting requests × retries.
    assert.ok(gate.stats.lockAttempts < 100 + 40, `lock attempts ${gate.stats.lockAttempts}`);
    assert.ok(maxLag < 200, `event loop lag ${maxLag.toFixed(0)} ms must stay under 200 ms`);
    api.close();
    holder.close();
  });

  test('after 5 s counted from arrival the request fails with BusyError (503 busy)', async () => {
    const api = new Db(file, { role: 'api' });
    const holder = new Db(file, { role: 'batch' });
    const gate = new WriteGate(api, 300);
    holder.exec('BEGIN IMMEDIATE');
    const started = performance.now();
    await assert.rejects(gate.run(() => api.run("INSERT INTO t (v) VALUES ('late')")), BusyError);
    assert.ok(performance.now() - started < 700);
    // Time spent in the queue counts: a request that arrived long ago is refused without touching SQLite.
    await assert.rejects(gate.run(() => 1, { arrivedAt: performance.now() - 10_000 }), BusyError);
    holder.exec('ROLLBACK');
    assert.equal(await gate.run(() => 7), 7, 'the gate keeps working after refusals');
    api.close();
    holder.close();
  });

  test('a failing transaction rolls back and does not block the queue; async work is refused inside it', async () => {
    const api = new Db(file, { role: 'api' });
    const gate = new WriteGate(api);
    const before = api.value('SELECT count(*) FROM t');
    await assert.rejects(
      gate.run(() => {
        api.run("INSERT INTO t (v) VALUES ('doomed')");
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(api.value('SELECT count(*) FROM t'), before);
    await assert.rejects(gate.run(() => Promise.resolve(1) as unknown as number), /must not be asynchronous/);
    assert.equal(api.value('SELECT count(*) FROM t'), before);
    api.close();
  });

  test('busy is a distinguishable error (R-2)', () => {
    const a = new Db(file, { role: 'api' });
    const b = new Db(file, { role: 'batch' });
    b.exec('BEGIN IMMEDIATE');
    assert.throws(() => a.tx(() => 1), SqliteBusyError);
    b.exec('ROLLBACK');
    a.close();
    b.close();
  });
});

describe('replace_live_database (SYNC §3.2)', () => {
  test('every replacement raises the epoch, changes the nonce and lifts the counter; twice from one snapshot never repeats an epoch', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    try {
      const { ctx } = bag;
      const snapshot = join(bag.dir, 'snap.sqlite3');
      vacuumInto(ctx.db, snapshot);
      const nonceBefore = ctx.meta('epoch_nonce');
      const seqBefore = ctx.metaInt('change_seq');
      const dbPath = ctx.paths.mainDb;
      ctx.db.close();
      const first = replaceLiveDatabase({ dbPath, source: snapshot, asideDir: join(bag.dir, 'aside1'), minEpoch: 0, restoredFrom: 'test' });
      const second = replaceLiveDatabase({ dbPath, source: snapshot, asideDir: join(bag.dir, 'aside2'), minEpoch: 0, restoredFrom: 'test' });
      assert.equal(first, 2);
      assert.equal(second, 3, 'the epoch floor on the card prevents reuse');
      assert.equal(readEpochFloor(dbPath), 3);
      const db = new Db(dbPath, { role: 'batch' });
      const meta = (key: string) => String(db.value('SELECT value FROM bag_meta WHERE key = ?', key));
      assert.notEqual(meta('epoch_nonce'), nonceBefore);
      assert.equal(Number(meta('change_seq')), 3 * 2 ** 40);
      assert.ok(Number(meta('change_seq')) > seqBefore);
      assert.equal(meta('epoch_base_seq'), meta('change_seq'));
      assert.equal(liftEpoch(db, 9, null), 10, 'the office can demand a higher epoch (restore --min-epoch)');
      db.close();
    } finally {
      rmSync(bag.dir, { recursive: true, force: true });
    }
  });
});

describe('HTTP rules', () => {
  let bag: Bag;
  let c: Client;
  before(async () => {
    bag = await makeBag();
    c = new Client(bag);
  });
  after(() => bag.close());

  test('health', async () => {
    const r = await c.get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['maintenance', 'ok', 'version']);
  });

  test('every unsafe method needs X-Sensebod-Offline-Client: 1; OPTIONS is never approved; a foreign Origin is refused (SEC-2)', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await c.request(method, '/learners', { name: 'A', role: 'learner', pin: '1234' }, { 'X-Sensebod-Offline-Client': '' });
      assert.equal(r.status, 403, method);
      assert.equal(r.body.error.code, 'csrf');
    }
    const preflight = await fetch(`${bag.base}/learners`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    for (const origin of ['http://evil.example', 'null']) {
      const r = await c.post('/learners', { name: 'A', role: 'learner', pin: '1234' }, { ...c.key(), Origin: origin });
      assert.equal(r.status, 403, origin);
    }
    const own = await c.post('/learners', { name: 'A', role: 'learner', pin: '1234' }, { ...c.key(), Origin: new URL(bag.base).origin });
    assert.equal(own.status, 201);
  });

  test('only the bag\'s own names are answered (Host allow-list)', async () => {
    const r = await rawGet(`${bag.base}/health`, { Host: 'materials.example.org' });
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(r.text).error.code, 'bad_host');
  });

  test('errors have the contract shape, unknown paths are 404, broken JSON is 422, nothing leaks', async () => {
    const missing = await c.get('/no/such/thing');
    assert.equal(missing.status, 404);
    assert.equal(typeof missing.body.error.message, 'string');
    const broken = await fetch(`${bag.base}/learners`, { method: 'POST', headers: { 'X-Sensebod-Offline-Client': '1', 'Idempotency-Key': 'broken-json-1' }, body: '{"name":' });
    assert.equal(broken.status, 422);
    const odd = await fetch(`${bag.base}/lessons/%E0%A4%A`);
    assert.equal(odd.status, 400);
    assert.ok(!/stack|at .*\.ts/.test(await odd.text()));
    const large = await fetch(`${bag.base}/learners`, { method: 'POST', headers: { 'X-Sensebod-Offline-Client': '1', 'Idempotency-Key': 'too-large-1' }, body: 'x'.repeat(1024 * 1024 + 10) });
    assert.equal(large.status, 413);
  });

  test('content answers carry an ETag and honour If-None-Match; learner answers are no-store', async () => {
    const first = await c.get('/portals');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-cache');
    const tag = first.headers.get('etag') as string;
    assert.match(tag, /^W\/"c\d+\./);
    assert.equal((await c.get('/portals', { 'If-None-Match': tag })).status, 304);
    assert.notEqual((await c.get('/portals/primary')).headers.get('etag'), tag, 'the tag depends on the path');
    const hub = new Client(bag);
    await hub.signIn({ username: 'hub', password: 'correct horse battery' });
    const draft = await hub.post('/admin/lessons', { source: 'typed', title: 'T', blocks: [{ kind: 'paragraph', text: 'x' }] }, hub.key());
    assert.equal(draft.headers.get('cache-control'), 'no-store');
    await hub.patch(`/admin/lessons/${draft.body.id}`, { placement: { portalId: 'climate', groupId: (await c.get('/portals/climate')).body.groups[0].id, seriesId: (await c.get(`/groups/${(await c.get('/portals/climate')).body.groups[0].id}`)).body.series[0].id, position: 1 } });
    assert.equal((await c.get('/portals', { 'If-None-Match': tag })).status, 200, 'a change learners can see changes every tag');
  });

  test('idempotency: replay, mismatch, and a key is needed where the contract says so', async () => {
    const key = c.key();
    const a = await c.post('/learners', { name: 'Mariama', role: 'learner', pin: '1234' }, key);
    const b = await c.post('/learners', { name: 'Mariama', role: 'learner', pin: '1234' }, key);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.id, b.body.id);
    assert.equal(Number(bag.ctx.db.value("SELECT count(*) FROM learner WHERE name = 'Mariama'")), 1);
    const other = await c.post('/learners', { name: 'Someone else', role: 'learner', pin: '1234' }, key);
    assert.equal(other.status, 422);
    assert.equal(other.body.error.code, 'idempotency_mismatch');
    assert.equal((await c.post('/learners', { name: 'No key', role: 'learner', pin: '1234' })).status, 422);
    assert.equal((await c.post('/learners', { name: 'Short', role: 'learner', pin: '1234' }, { 'Idempotency-Key': 'short' })).status, 422);
  });

  test('the request log holds route templates only: no path, id, query, name, token or address (R-9, SEC-7)', async () => {
    const made = await c.post('/learners', { name: 'Fatmata Kamara', role: 'learner', pin: '1234' }, c.key());
    const id = made.body.id as string;
    await c.put(`/learners/${id}/progress/primary-class-1-english-language-1`, { state: 'started' });
    await c.get(`/learners/${id}/progress?seriesId=primary-class-1-english-language`);
    await c.post('/lessons/cp-child-staying-safe-1/activity', { event: 'opened', viewId: 'a'.repeat(32) });
    await sleep(30);
    const http = bag.logs.filter((line) => line.includes('"ev":"http"'));
    assert.ok(http.some((line) => line.includes('"route":"PUT /learners/{learnerId}/progress/{lessonId}"')));
    assert.ok(http.some((line) => line.includes('"route":"POST /lessons/{lessonId}/activity"')));
    const all = bag.logs.join('\n');
    assert.ok(!all.includes(id), 'no learner id');
    assert.ok(!all.includes('Fatmata'), 'no name');
    assert.ok(!all.includes('cp-child-staying-safe-1'), 'no Child protection lesson id');
    assert.ok(!all.includes('10.10.0.51'), 'no client address');
    assert.ok(!all.includes('seriesId='), 'no query string');
    for (const line of http) assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['ev', 'ms', 'role', 'route', 'status']);
  });

  test('the log filter redacts learner ids and sensitive lesson ids even when code tries to log them', () => {
    setSensitiveLessonIds(['cp-child-staying-safe-1']);
    const before = redactionCount();
    assert.equal(redact('x lr-abcdefghijklmnopqrstuvwxyz y cp-child-staying-safe-1 z'), 'x [redacted] y [redacted] z');
    log('test', { note: 'lr-abcdefghijklmnopqrstuvwxyz' });
    assert.ok(redactionCount() > before);
    assert.ok(bag.logs.at(-1)?.includes('[redacted]'));
  });
});
