/*
 * Release self-check (R-11, P-1): proves on THIS machine that the runtime in
 * the release can do what the backend needs, before anything is switched over.
 * It works in a scratch folder under the data directory (the bag's own card),
 * never on the live databases:
 *   - runtime, platform and architecture; SQLite version as the driver reports it
 *   - open a database in WAL, one durable write with RETURNING, one VACUUM INTO
 *   - both live databases open read-only and pass quick_check (when they exist)
 *   - scrypt (the password KDF) runs and how long one hash takes
 *   - the effective UV_THREADPOOL_SIZE (V-028)
 * The release has no native modules (node:sqlite, node:crypto and node:zlib
 * are part of the runtime), so "every native module loads" is this list.
 */
import { scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { type Config, paths as buildPaths } from '../config.ts';
import { Db, checkDatabase, sqliteVersion } from '../core/db.ts';
import { expectedHead, headState } from '../core/migrate.ts';
import { vacuumInto } from '../exports/snapshots.ts';
import { VERSION } from '../version.ts';

export interface SelfCheckReport {
  ok: boolean;
  version: string;
  node: string;
  platform: string;
  arch: string;
  sqlite: string | null;
  uvThreadpoolSize: number;
  scryptMs: number | null;
  checks: { name: string; ok: boolean; detail: string }[];
}

export function selfCheck(config: Config): SelfCheckReport {
  const p = buildPaths(config);
  const checks: SelfCheckReport['checks'] = [];
  const add = (name: string, work: () => string): void => {
    try {
      checks.push({ name, ok: true, detail: work() });
    } catch (error) {
      checks.push({ name, ok: false, detail: (error as Error).message });
    }
  };
  let sqlite: string | null = null;
  let scryptMs: number | null = null;
  const scratch = join(existsSync(p.tmp) ? p.tmp : os.tmpdir(), `selfcheck-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  try {
    add('sqlite: WAL, durable write, RETURNING', () => {
      const db = new Db(join(scratch, 'check.sqlite3'), { role: 'batch', skipWalAssert: true });
      try {
        db.exec('PRAGMA journal_mode=WAL');
        sqlite = sqliteVersion(db);
        db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER NOT NULL)');
        const value = db.tx(() => {
          db.run("INSERT INTO t VALUES ('n', 0)");
          return db.value<number>("UPDATE t SET v = v + 1 WHERE k = 'n' RETURNING v");
        });
        if (value !== 1) throw new Error('RETURNING did not answer 1.');
        vacuumInto(db, join(scratch, 'copy.sqlite3'));
        return `SQLite ${sqlite}`;
      } finally {
        db.close();
      }
    });
    add('sqlite: VACUUM INTO copy is sound', () => {
      const copy = new Db(join(scratch, 'copy.sqlite3'), { role: 'batch', readOnly: true, skipWalAssert: true });
      try {
        if (!checkDatabase(copy, true)) throw new Error('integrity_check failed on the copy.');
        return 'integrity_check ok';
      } finally {
        copy.close();
      }
    });
    for (const [which, file] of [['main', p.mainDb], ['counts', p.countsDb]] as const) {
      if (!existsSync(file)) continue;
      add(`live ${which} database opens`, () => {
        const db = new Db(file, { role: 'batch', readOnly: true });
        try {
          if (!checkDatabase(db)) throw new Error('quick_check failed.');
          return `quick_check ok, schema ${headState(db, which)} (release head ${expectedHead(which)})`;
        } finally {
          db.close();
        }
      });
    }
    add('scrypt (password hashing)', () => {
      const started = performance.now();
      scryptSync('selfcheck', Buffer.alloc(16, 1), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 256 * 2 ** 15 * 8 });
      scryptMs = Math.round(performance.now() - started);
      return `${scryptMs} ms per hash (target < 1000 ms, PERF-1)`;
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return {
    ok: checks.every((c) => c.ok),
    version: VERSION,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sqlite,
    uvThreadpoolSize: Number(process.env.UV_THREADPOOL_SIZE ?? 4),
    scryptMs,
    checks,
  };
}
