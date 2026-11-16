/*
 * Migration runner (R-5, DATABASE §10): numbered, forward-only .sql files, each
 * applied in ONE transaction together with its row in schema_migrations, so a
 * power cut leaves a migration either fully applied or not at all, and running
 * the runner again is safe. It is called only by the update procedure and by
 * provisioning, never when the API starts (the API only asserts the head).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from './db.ts';
import { sha256Hex } from './ids.ts';
import { nowIso } from './time.ts';

export type Which = 'main' | 'counts';

export interface Migration {
  id: string;
  sql: string;
  checksum: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The folder holding migrations/, both when run from source (src/core) and from the build (dist/src/core). */
export function migrationsDir(which: Which): string {
  for (const up of ['../..', '../../..']) {
    const dir = join(HERE, up, 'migrations', which);
    try {
      readdirSync(dir);
      return dir;
    } catch {
      // try the next layout
    }
  }
  throw new Error(`The migrations folder for ${which} was not found.`);
}

export function listMigrations(which: Which): Migration[] {
  const dir = migrationsDir(which);
  return readdirSync(dir)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { id: name.replace(/\.sql$/, ''), sql, checksum: sha256Hex(sql) };
    });
}

function ensureTable(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)');
}

export function appliedMigrations(db: Db): { id: string; checksum: string }[] {
  const has = db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  return has ? db.all<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations ORDER BY id') : [];
}

/** Apply every pending migration. Returns the ids applied now. */
export function migrate(db: Db, which: Which): string[] {
  ensureTable(db);
  const done = new Map(appliedMigrations(db).map((m) => [m.id, m.checksum]));
  const applied: string[] = [];
  for (const migration of listMigrations(which)) {
    const before = done.get(migration.id);
    if (before !== undefined) {
      if (before !== migration.checksum) throw new Error(`Migration ${migration.id} was changed after it was applied.`);
      continue;
    }
    // SQLite's documented table-rebuild procedure needs foreign keys OFF while tables are dropped and
    // renamed (with them ON, DROP TABLE cascades deletes into child tables). The pragma cannot change
    // inside a transaction, so it is switched around it; integrity is proven by foreign_key_check
    // before COMMIT instead.
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      db.tx(() => {
        db.exec(migration.sql);
        db.run('INSERT INTO schema_migrations (id, applied_at, checksum) VALUES (?, ?, ?)', migration.id, nowIso(), migration.checksum);
        const broken = db.all('PRAGMA foreign_key_check');
        if (broken.length > 0) throw new Error(`Migration ${migration.id} left ${broken.length} broken foreign keys.`);
      });
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
    applied.push(migration.id);
  }
  return applied;
}

export function expectedHead(which: Which): string {
  const all = listMigrations(which);
  const last = all[all.length - 1];
  if (!last) throw new Error(`No migrations for ${which}.`);
  return last.id;
}

export type HeadState = 'equal' | 'behind' | 'ahead' | 'empty';

/** Compare the database with the release: the API starts only on 'equal'. */
export function headState(db: Db, which: Which): HeadState {
  const applied = appliedMigrations(db).map((m) => m.id);
  if (applied.length === 0) return 'empty';
  const known = listMigrations(which).map((m) => m.id);
  if (applied.some((id) => known.indexOf(id) === -1)) return 'ahead';
  return applied.length === known.length ? 'equal' : 'behind';
}
