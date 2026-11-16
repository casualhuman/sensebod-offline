/* Regression tests for findings of the independent review, round 2 (docs/reviews/backend/BACKEND-REVIEW-2.md). */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { paths as buildPaths } from '../src/config.ts';
import { Ctx, loadKeys } from '../src/core/context.ts';
import { Db } from '../src/core/db.ts';
import { sha256Hex } from '../src/core/ids.ts';
import { incomingPath, stagedPath } from '../src/core/replace.ts';
import { vacuumInto } from '../src/exports/snapshots.ts';
import { inspect } from '../src/media/jobs.ts';
import { insertBlob, storeFile } from '../src/media/store.ts';
import { bootRecover } from '../src/system/bootstrap.ts';
import { collectGarbage } from '../src/system/maint.ts';
import type { JobRow } from '../src/worker/queue.ts';
import { ADMIN, Client, makeBag, signedIn } from './harness.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 5)]);
const OLD = '2026-01-01T00:00:00.000Z';

describe('review round 2', () => {
  test('BR-036: garbage collection removes a file an old upload still names, run after run; files in use are kept', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    try {
      const { ctx } = bag;
      const put = async (bytes: Buffer, name: string) => {
        const tmp = join(bag.dir, name);
        writeFileSync(tmp, bytes);
        const blob = await storeFile(ctx.paths, tmp, sha256Hex(bytes), bytes.length, 'png', 'upload', true);
        ctx.writeSync((tx) => insertBlob(tx, blob));
        return blob;
      };
      const unused = await put(PNG, 'a.png');
      const used = await put(Buffer.concat([PNG, Buffer.from('in use')]), 'b.png');
      ctx.writeSync((tx) => {
        // An upload from long ago still points at the first file; a picture uses the second.
        tx.run("INSERT INTO upload (id, file_name, mime_type, size_bytes, received_bytes, state, kind, blob_sha256, created_by, created_at, updated_at) VALUES ('up-old', 'a.png', 'image/png', 1, 1, 'ready', 'photo', ?, 'x', ?, ?)", unused.sha256, OLD, OLD);
        tx.run("INSERT INTO picture (id, grp, blob_sha256, alt, created_at, seq) VALUES ('pi-used', 'own', ?, 'x', ?, ?)", used.sha256, OLD, tx.seq());
      });
      assert.deepEqual(await collectGarbage(ctx), { marked: 1, deleted: 0 }, 'first seen unreferenced: marked, not deleted yet');
      ctx.writeSync((tx) => tx.run('UPDATE blob SET unreferenced_since = ? WHERE unreferenced_since IS NOT NULL', OLD));
      assert.deepEqual(await collectGarbage(ctx), { marked: 0, deleted: 1 });
      assert.deepEqual(await collectGarbage(ctx), { marked: 0, deleted: 0 }, 'and the next run works too');
      assert.ok(!existsSync(join(ctx.paths.media, unused.relPath)));
      assert.ok(existsSync(join(ctx.paths.media, used.relPath)));
      assert.equal(ctx.db.value("SELECT blob_sha256 FROM upload WHERE id = 'up-old'"), null);
      assert.equal(ctx.db.all('PRAGMA foreign_key_check').length, 0);
    } finally {
      await bag.close();
    }
  });

  test('BR-037: saving a picture-with-spots lesson again keeps its files tracked', async () => {
    const bag = await makeBag();
    try {
      const { ctx } = bag;
      const admin = await signedIn(bag, ADMIN);
      const tmp = join(bag.dir, 'scene.png');
      writeFileSync(tmp, PNG);
      const blob = await storeFile(ctx.paths, tmp, sha256Hex(PNG), PNG.length, 'png', 'upload', true);
      const lessonId = 'ls-tryitlesson';
      ctx.writeSync((tx) => {
        insertBlob(tx, blob);
        tx.run("INSERT INTO upload (id, file_name, mime_type, size_bytes, received_bytes, state, kind, blob_sha256, created_by, created_at, updated_at) VALUES ('up-scene', 'scene.png', 'image/png', ?, ?, 'ready', 'photo', ?, 'x', ?, ?)", PNG.length, PNG.length, blob.sha256, OLD, OLD);
        tx.run("INSERT INTO lesson (id, type, title, source, body_json, created_at, updated_at, seq) VALUES (?, 'try', 'Spots', 'animation', '{\"mode\":\"package\",\"packageUrl\":\"\"}', ?, ?, ?)", lessonId, OLD, OLD, tx.seq());
      });
      const spots = [{ id: 's1', label: 'Hen', role: '', says: 'Cluck', audioUrl: null, portrait: null, x: 10, y: 10, r: 5 }];
      const first = await admin.put(`/admin/lessons/${lessonId}/try-it`, { lessonId, mode: 'hotspots', sceneUploadId: 'up-scene', scene: { url: '', alt: 'A yard' }, spots, goal: 'all', instruction: '', finishMessage: '', gentleMovement: false });
      assert.equal(first.status, 200, first.text);
      const tracked = () => ctx.db.all<{ role: string }>('SELECT role FROM lesson_asset WHERE lesson_id = ?', lessonId).map((r) => r.role);
      assert.deepEqual(tracked(), ['scene']);
      // The screen sends back what it was given: the scene as a URL, no upload id.
      const second = await admin.put(`/admin/lessons/${lessonId}/try-it`, { ...first.body, spots });
      assert.equal(second.status, 200, second.text);
      assert.deepEqual(tracked(), ['scene'], 'still tracked after the second save');
      ctx.writeSync((tx) => tx.run("UPDATE upload SET updated_at = ? WHERE id = 'up-scene'", OLD));
      assert.equal((await collectGarbage(ctx)).marked, 0, 'so the collector does not see the scene as unused');
    } finally {
      await bag.close();
    }
  });

  test('BR-038: the inspect job can run again after it stored the file but before the row was committed', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    try {
      const { ctx } = bag;
      const part = join(ctx.paths.uploadsPartial, 'up-retry.part');
      mkdirSync(ctx.paths.uploadsPartial, { recursive: true });
      writeFileSync(part, PNG);
      ctx.writeSync((tx) => tx.run("INSERT INTO upload (id, file_name, mime_type, size_bytes, received_bytes, state, kind, becomes, created_by, created_at, updated_at) VALUES ('up-retry', 'p.png', 'image/png', ?, ?, 'processing', 'photo', 'read', 'x', ?, ?)", PNG.length, PNG.length, OLD, OLD));
      const env = { config: bag.config, paths: ctx.paths, job: { id: 'jb-1', kind: 'inspect', payload: { uploadId: 'up-retry' } }, workDir: join(bag.dir, 'w'), progress() {} };
      const once = (await inspect.run(env)) as { sha256: string };
      assert.ok(existsSync(part), 'the raw upload stays until the commit');
      // Power cut here: nothing was committed. The retry must find the bytes.
      const twice = (await inspect.run(env)) as { sha256: string };
      assert.equal(twice.sha256, once.sha256);
      const after = ctx.writeSync((tx) => inspect.finalize(ctx, tx, { id: 'jb-1', kind: 'inspect', lane: 'media', payload_json: '{"uploadId":"up-retry"}' } as JobRow, twice));
      if (after) after();
      assert.ok(!existsSync(part), 'removed once the row says where the file is');
      assert.equal(ctx.db.value("SELECT state FROM upload WHERE id = 'up-retry'"), 'ready');
    } finally {
      await bag.close();
    }
  });

  test('BR-039, BR-040: boot recovery finishes only a fully staged replacement, and repairs a sound database left in rollback mode', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    const p = buildPaths(bag.config);
    const reopen = (): Db => new Db(p.mainDb, { role: 'batch' });
    const boot = (id: string) => {
      writeFileSync(p.bootJson, JSON.stringify({ bootId: id }));
      return bootRecover(bag.config);
    };
    try {
      const copy = join(bag.dir, 'copy.sqlite3');
      vacuumInto(bag.ctx.db, copy);
      bag.ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      bag.ctx.close();

      // (a) A half-made `.incoming` next to a healthy database is dropped and never used.
      copyFileSync(copy, incomingPath(p.mainDb));
      assert.equal(boot('b1').maintenance, false);
      assert.ok(!existsSync(incomingPath(p.mainDb)));

      // (b) Only an unlifted `.incoming` and no live file: it must NOT go live (it would reuse the old epoch).
      const parked = join(bag.dir, 'parked');
      mkdirSync(parked);
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(p.mainDb + suffix)) renameSync(p.mainDb + suffix, join(parked, `db${suffix}`));
      copyFileSync(copy, incomingPath(p.mainDb));
      assert.throws(() => boot('b2'), /missing/);
      assert.ok(!existsSync(p.mainDb));

      // (c) A `.staged` file (complete and lifted) and no live file: finished.
      copyFileSync(copy, stagedPath(p.mainDb));
      const finished = boot('b3');
      assert.equal(finished.maintenance, false);
      assert.match(finished.notes.join(' '), /finished after a power cut/);
      let db = reopen();
      assert.equal(db.value('PRAGMA journal_mode'), 'wal');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();

      // (d) The cut between "renamed in" and "switched to WAL": a sound file in rollback mode is put right, not refused.
      rmSync(p.mainDb + '-wal', { force: true });
      rmSync(p.mainDb + '-shm', { force: true });
      copyFileSync(copy, p.mainDb);
      assert.equal(boot('b4').maintenance, false);
      db = reopen();
      assert.equal(db.value('PRAGMA journal_mode'), 'wal');
      db.close();
      assert.ok(!readdirSync(p.dbDir).some((name) => name.startsWith('corrupt-')), 'none of this was treated as corruption');
    } finally {
      (bag as { ctx: unknown }).ctx = new Ctx({ config: bag.config, role: 'batch', version: 'test', boot: bootRecover(bag.config).boot, keys: loadKeys(p) });
      await bag.close();
    }
  });

  test('BR-041: the idempotency record of "Save my progress" holds no name, and a replay still answers the learner', async () => {
    const bag = await makeBag();
    try {
      const c = new Client(bag);
      const key = c.key();
      const made = await c.post('/learners', { name: 'Hawa Bangura', role: 'learner', pin: '1234' }, key);
      const records = JSON.stringify(bag.ctx.db.all('SELECT * FROM idempotency_record'));
      assert.ok(!records.includes('Hawa'), 'no name in the record');
      const replay = await c.post('/learners', { name: 'Hawa Bangura', role: 'learner', pin: '1234' }, key);
      assert.deepEqual(replay.body, made.body);
      await c.delete(`/learners/${made.body.id}`);
      assert.equal((await c.post('/learners', { name: 'Hawa Bangura', role: 'learner', pin: '1234' }, key)).status, 404, 'a replay after the learner was removed creates nothing and names nobody');
      assert.equal(Number(bag.ctx.db.value('SELECT count(*) FROM learner')), 0);
    } finally {
      await bag.close();
    }
  });

  test('BR-044: a restore that was cut after the swap keeps the bag closed until it is run again', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    const p = buildPaths(bag.config);
    try {
      mkdirSync(p.restore, { recursive: true });
      writeFileSync(join(p.restore, 'state.json'), JSON.stringify({ id: 'r-1', step: 'swapped' }));
      writeFileSync(p.bootJson, JSON.stringify({ bootId: 'earlier' }));
      const cut = bootRecover(bag.config);
      assert.equal(cut.maintenance, true);
      assert.ok(existsSync(p.maintenanceFlag));
      // BR-063: the same for a cut in the middle of the swap itself.
      rmSync(p.maintenanceFlag, { force: true });
      writeFileSync(join(p.restore, 'state.json'), JSON.stringify({ id: 'r-1', step: 'swapping' }));
      writeFileSync(p.bootJson, JSON.stringify({ bootId: 'earlier-2' }));
      assert.equal(bootRecover(bag.config).maintenance, true);
      assert.ok(existsSync(p.maintenanceFlag) && existsSync(join(p.restore, 'state.json')));
      // Before the swap nothing was changed: the journal is dropped and the bag opens.
      writeFileSync(join(p.restore, 'state.json'), JSON.stringify({ id: 'r-1', step: 'prepared' }));
      assert.equal(bootRecover(bag.config).maintenance, false);
      assert.ok(!existsSync(join(p.restore, 'state.json')) && !existsSync(p.maintenanceFlag));
    } finally {
      await bag.close();
    }
  });
});

describe('review round 3', () => {
  test('BR-061: boot recovery keeps the raw file of an upload that is still being processed', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    try {
      const { ctx } = bag;
      mkdirSync(ctx.paths.uploadsPartial, { recursive: true });
      const part = join(ctx.paths.uploadsPartial, 'up-cut.part');
      const stray = join(ctx.paths.uploadsPartial, 'up-nobody.part');
      writeFileSync(part, PNG);
      writeFileSync(stray, PNG);
      ctx.writeSync((tx) => tx.run("INSERT INTO upload (id, file_name, mime_type, size_bytes, received_bytes, state, kind, becomes, created_by, created_at, updated_at) VALUES ('up-cut', 'p.png', 'image/png', ?, ?, 'processing', 'photo', 'read', 'x', ?, ?)", PNG.length, PNG.length, OLD, OLD));
      // Power cut while the inspect job ran: the next boot.
      writeFileSync(ctx.paths.bootJson, JSON.stringify({ bootId: 'earlier' }));
      assert.equal(bootRecover(bag.config).maintenance, false);
      assert.ok(existsSync(part), 'the retried job still finds the bytes');
      assert.ok(!existsSync(stray), 'a file no upload names is removed');
      const env = { config: bag.config, paths: ctx.paths, job: { id: 'jb-1', kind: 'inspect', payload: { uploadId: 'up-cut' } }, workDir: join(bag.dir, 'w'), progress() {} };
      assert.equal(((await inspect.run(env)) as { sha256: string }).sha256, sha256Hex(PNG));
    } finally {
      await bag.close();
    }
  });

  test('BR-062: a write-ahead log left by the replaced database is not replayed onto the staged file finished at boot', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    const p = buildPaths(bag.config);
    try {
      const copy = join(bag.dir, 'copy.sqlite3');
      const before = bag.ctx.metaInt('content_rev');
      vacuumInto(bag.ctx.db, copy);
      // A change of the old database that only its log holds.
      bag.ctx.writeSync((tx) => tx.run("UPDATE bag_meta SET value = value + 1000 WHERE key = 'content_rev'"));
      const oldWal = join(bag.dir, 'old-wal');
      execFileSync('cp', [`${p.mainDb}-wal`, oldWal]);
      bag.ctx.close();
      // The cut of the replacement: the old file is gone, its log is still there, the new file is staged.
      for (const suffix of ['', '-wal', '-shm']) rmSync(p.mainDb + suffix, { force: true });
      copyFileSync(oldWal, `${p.mainDb}-wal`);
      copyFileSync(copy, stagedPath(p.mainDb));
      writeFileSync(p.bootJson, JSON.stringify({ bootId: 'earlier' }));
      assert.equal(bootRecover(bag.config).maintenance, false);
      const db = new Db(p.mainDb, { role: 'batch' });
      assert.equal(Number(db.value("SELECT value FROM bag_meta WHERE key = 'content_rev'")), before);
      assert.equal(db.value('PRAGMA quick_check'), 'ok');
      db.close();
    } finally {
      (bag as { ctx: unknown }).ctx = new Ctx({ config: bag.config, role: 'batch', version: 'test', boot: bootRecover(bag.config).boot, keys: loadKeys(p) });
      await bag.close();
    }
  });
});
