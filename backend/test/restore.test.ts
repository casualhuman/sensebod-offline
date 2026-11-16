/* BE-10: restore from a backup and new-epoch (BK-3 on a laptop, SYNC-1). `age` is a pass-through stand-in here; the real tool is a Pi test. */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { paths as buildPaths } from '../src/config.ts';
import { Db } from '../src/core/db.ts';
import { listSnapshots } from '../src/exports/snapshots.ts';
import { bootRecover } from '../src/system/bootstrap.ts';
import { RestoreRefused, newEpoch, restoreBackup } from '../src/system/restore.ts';
import { handlerFor } from '../src/worker/registry.ts';
import { makeBag } from './harness.ts';

function fakeAge(): string {
  const dir = join(os.tmpdir(), `sb-age-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'age');
  writeFileSync(file, '#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done\ncat > "$out"\n');
  chmodSync(file, 0o755);
  return file;
}

describe('restore and new-epoch', () => {
  test('a backup comes back whole, on a new epoch above the bag, the backup and the office; refusals change nothing', async () => {
    const bag = await makeBag({ listen: false, role: 'batch', toml: `[tools]\nage = "${fakeAge()}"\n` });
    const p = buildPaths(bag.config);
    try {
      writeFileSync(bag.config.paths.recipientsFile, 'age1testrecipient\n');
      const addLearner = (id: string, name: string): void => {
        bag.ctx.writeSync((tx) => tx.run("INSERT INTO learner (id, name, role, created_at, seq) VALUES (?, ?, 'learner', '2026-11-01T00:00:00.000Z', ?)", `lr-${id.repeat(26)}`, name, tx.seq()));
      };
      addLearner('a', 'In the backup');
      const result = (await handlerFor('data', 'backup_records')?.run({
        config: bag.config,
        paths: p,
        job: { id: 'jb-test', kind: 'backup_records', payload: { exportId: 'ex-testtesttesttesttesttestte', destination: 'download', options: {} } },
        workDir: join(bag.dir, 'work'),
        progress() {},
      })) as { fileName: string };
      const backup = join(p.exports, result.fileName);
      addLearner('b', 'Only on the bag');
      const ticketBefore = readFileSync(join(p.keys, 'ticket.key'));
      const seqBefore = bag.ctx.metaInt('change_seq');
      bag.ctx.close();

      // A damaged backup is refused before anything is touched.
      const damaged = join(bag.dir, 'damaged.tar');
      const bytes = readFileSync(backup);
      bytes[bytes.length - 3000] = (bytes[bytes.length - 3000] as number) ^ 0xff;
      writeFileSync(damaged, bytes);
      assert.throws(() => restoreBackup(bag.config, { tarFile: damaged, minEpoch: 0, confirm: () => true }), RestoreRefused);
      // Not confirmed: nothing changes either.
      let seen: { learnersOnlyOnBag: number; newEpoch: number } | null = null;
      assert.throws(() => restoreBackup(bag.config, { tarFile: backup, minEpoch: 5, confirm: (summary) => ((seen = summary), false) }), /not confirmed/);
      assert.deepEqual([seen!.learnersOnlyOnBag, seen!.newEpoch], [1, 6], 'the technician is told what will be lost and the new epoch');
      const untouched = new Db(p.mainDb, { role: 'batch' });
      assert.equal(Number(untouched.value('SELECT count(*) FROM learner')), 2);
      assert.equal(Number(untouched.value("SELECT value FROM bag_meta WHERE key = 'epoch'")), 1);
      untouched.close();
      assert.ok(!existsSync(join(p.restore, 'state.json')) && !existsSync(p.maintenanceFlag));

      // The office has imported epoch 5 from this bag's dead card: the new lineage must sort after it (V-008).
      let stopped = 0;
      const report = restoreBackup(bag.config, { tarFile: backup, minEpoch: 5, confirm: () => true, services: { stop: () => void (stopped += 1), start: () => void (stopped += 10) } });
      assert.equal(stopped, 11, 'services were stopped, then started');
      assert.equal(report.newEpoch, 6);
      assert.equal(report.learnersOnlyOnBag, 1);
      const db = new Db(p.mainDb, { role: 'batch' });
      const meta = (key: string): string => String(db.value('SELECT value FROM bag_meta WHERE key = ?', key));
      assert.deepEqual(db.all<{ name: string }>('SELECT name FROM learner').map((r) => r.name), ['In the backup']);
      assert.equal(meta('epoch'), '6');
      assert.ok(Number(meta('change_seq')) >= 6 * 2 ** 40 && Number(meta('change_seq')) > seqBefore);
      assert.match(meta('restored_from'), /^backup of \d{4}-\d{2}-\d{2}$/);
      assert.equal(db.value('PRAGMA journal_mode'), 'wal');
      assert.ok(db.get("SELECT 1 FROM audit_event WHERE action = 'restore' AND actor_id = 'technician-cli'"));
      assert.equal(Number(db.value('SELECT count(*) FROM admin_session')), 0);
      db.close();
      assert.ok(listSnapshots(p).some((s) => s.kind === 'pre-restore'), 'what was on the bag is kept as a pre-restore snapshot');
      assert.ok(readdirSync(p.dbDir).some((name) => name.startsWith('replaced-')));
      assert.notDeepEqual(readFileSync(join(p.keys, 'ticket.key')), ticketBefore, 'bag secrets are new after a restore');
      assert.ok(!existsSync(p.maintenanceFlag) && !existsSync(join(p.restore, 'state.json')));
      // The bag boots normally afterwards.
      const boot = bootRecover(bag.config);
      assert.equal(boot.maintenance, false);

      // new-epoch: every row changed in this lineage gets a fresh sequence under the new epoch, in its old order.
      const live = new Db(p.mainDb, { role: 'batch' });
      const next = (): number => Number((live.get<{ value: string }>("UPDATE bag_meta SET value = value + 1 WHERE key = 'change_seq' RETURNING value") as { value: string }).value);
      live.tx(() => {
        live.run("INSERT INTO learner (id, name, role, created_at, seq) VALUES (?, 'First after', 'learner', 'x', ?)", `lr-${'c'.repeat(26)}`, next());
        live.run("INSERT INTO tombstone (entity, entity_id, seq, deleted_at) VALUES ('learner', 'lr-gone', ?, 'x')", next());
      });
      live.close();
      const moved = newEpoch(bag.config, 9);
      assert.deepEqual(moved, { epoch: 10, restamped: 2 });
      const after = new Db(p.mainDb, { role: 'batch' });
      const learnerSeq = Number(after.value("SELECT seq FROM learner WHERE name = 'First after'"));
      const stoneSeq = Number(after.value("SELECT seq FROM tombstone WHERE entity_id = 'lr-gone'"));
      assert.ok(learnerSeq > 10 * 2 ** 40 && stoneSeq > learnerSeq, 're-stamped above the new epoch, order kept');
      assert.ok(Number(after.value("SELECT seq FROM learner WHERE name = 'In the backup'")) < 2 ** 40, 'rows of the old lineage keep their numbers');
      after.close();
    } finally {
      // The harness closes a context; give it a fresh one on the restored file.
      const { Ctx, loadKeys } = await import('../src/core/context.ts');
      (bag as { ctx: unknown }).ctx = new Ctx({ config: bag.config, role: 'batch', version: 'test', boot: bootRecover(bag.config).boot, keys: loadKeys(p) });
      await bag.close();
    }
  });
});
