/*
 * SQLite access (R-2, R-3, DATABASE §3).
 *
 * Driver: node:sqlite (built into the pinned Node.js runtime, so the release
 * carries no native module). It is synchronous, like better-sqlite3: a
 * transaction runs to its end inside one turn of the event loop, so two
 * requests can never interleave inside one transaction. Everything that talks
 * to the driver is in this file; swapping the driver touches nothing else.
 *
 * The connection-open routine below applies DATABASE §3 on every connection,
 * in every process.
 */
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';

export type Param = SQLInputValue;
export type Row = Record<string, unknown>;

export type DbRole =
  /** The HTTP process: never waits inside SQLite (busy_timeout=0, R-3a). */
  | 'api'
  /** Worker, job children, maint, boot-recover, CLIs: may wait up to 5 s. */
  | 'batch'
  /** The connection that attempts a TRUNCATE checkpoint: gives up after 100 ms (R-3H). */
  | 'checkpoint';

const BUSY_TIMEOUT: Record<DbRole, number> = { api: 0, batch: 5000, checkpoint: 100 };

export class SqliteBusyError extends Error {}
export class SqliteFullError extends Error {}
export class SqliteCorruptError extends Error {}
export class SqliteConstraintError extends Error {}

/** Map a driver error to one of the distinguishable classes (R-2). Other errors pass through. */
export function classify(error: unknown): unknown {
  const e = error as { code?: string; errcode?: number; message?: string };
  if (!e || e.code !== 'ERR_SQLITE_ERROR' || typeof e.errcode !== 'number') return error;
  const primary = e.errcode & 0xff;
  const message = e.message ?? 'SQLite error';
  if (primary === 5 || primary === 6) return new SqliteBusyError(message);
  if (primary === 13) return new SqliteFullError(message);
  if (primary === 11 || primary === 26) return new SqliteCorruptError(message);
  if (primary === 19) return new SqliteConstraintError(message);
  return error;
}

export interface OpenOptions {
  role: DbRole;
  readOnly?: boolean;
  /** Skip the WAL assertion (only for a file being created or a snapshot being checked). */
  skipWalAssert?: boolean;
}

export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private readonly statements = new Map<string, StatementSync>();
  private inTx = false;

  constructor(path: string, options: OpenOptions) {
    this.path = path;
    try {
      this.raw = new DatabaseSync(path, { readOnly: options.readOnly === true });
      // DATABASE §3. journal_mode is persistent and only asserted here; it is set once at provisioning.
      this.raw.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT[options.role]}`);
      this.raw.exec('PRAGMA foreign_keys=ON');
      this.raw.exec('PRAGMA synchronous=FULL');
      this.raw.exec('PRAGMA journal_size_limit=67108864');
      this.raw.exec('PRAGMA wal_autocheckpoint=1000');
      this.raw.exec('PRAGMA cache_size=-16000');
      this.raw.exec('PRAGMA temp_store=FILE');
      this.raw.exec('PRAGMA mmap_size=0');
      this.raw.exec('PRAGMA secure_delete=OFF');
      if (!options.skipWalAssert) {
        const mode = (this.raw.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined)?.journal_mode;
        if (mode !== 'wal') throw new Error(`The database ${path} is not in WAL mode (journal_mode=${String(mode)}).`);
      }
    } catch (error) {
      throw classify(error);
    }
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    try {
      return this.statement(sql).get(...params) as T | undefined;
    } catch (error) {
      throw classify(error);
    }
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    try {
      return this.statement(sql).all(...params) as T[];
    } catch (error) {
      throw classify(error);
    }
  }

  run(sql: string, ...params: Param[]): number {
    try {
      return Number(this.statement(sql).run(...params).changes);
    } catch (error) {
      throw classify(error);
    }
  }

  exec(sql: string): void {
    try {
      this.raw.exec(sql);
    } catch (error) {
      throw classify(error);
    }
  }

  /** One value of one row, e.g. a count. */
  value<T = unknown>(sql: string, ...params: Param[]): T | undefined {
    const row = this.get<Row>(sql, ...params);
    if (!row) return undefined;
    const keys = Object.keys(row);
    return row[keys[0] as string] as T;
  }

  /**
   * One write transaction: BEGIN IMMEDIATE … COMMIT (DATABASE §3). `fn` is
   * synchronous on purpose: no await, timer, file or network I/O can happen
   * inside a write transaction (R-3). Throws SqliteBusyError if the lock is
   * held elsewhere and this connection's busy_timeout runs out.
   */
  tx<T>(fn: () => T, options: { secureDelete?: boolean } = {}): T {
    if (this.inTx) throw new Error('Nested write transaction.');
    // secure_delete must be set outside the transaction; it is reset in `finally` (V-013).
    if (options.secureDelete) this.exec('PRAGMA secure_delete=ON');
    try {
      this.exec('BEGIN IMMEDIATE');
      this.inTx = true;
      try {
        const result = fn();
        if (result instanceof Promise) throw new Error('A write transaction must not be asynchronous (R-3).');
        this.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.raw.exec('ROLLBACK');
        } catch {
          // The transaction was already rolled back by SQLite (e.g. SQLITE_FULL).
        }
        throw error;
      } finally {
        this.inTx = false;
      }
    } finally {
      if (options.secureDelete) this.exec('PRAGMA secure_delete=OFF');
    }
  }

  get inTransaction(): boolean {
    return this.inTx;
  }

  close(): void {
    this.statements.clear();
    try {
      this.raw.close();
    } catch {
      // already closed
    }
  }
}

/** `PRAGMA quick_check` / `integrity_check` → true when the only row is "ok". */
export function checkDatabase(db: Db, full = false): boolean {
  const rows = db.all<Row>(full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check');
  if (rows.length !== 1) return false;
  const first = rows[0] as Row;
  return Object.values(first)[0] === 'ok';
}

export function sqliteVersion(db: Db): string {
  return String(db.value('SELECT sqlite_version()'));
}

/** SQLite ≥ 3.35 is needed for RETURNING (DATABASE §3). */
export function assertSqliteVersion(db: Db): void {
  const [major = 0, minor = 0] = sqliteVersion(db).split('.').map(Number);
  if (major < 3 || (major === 3 && minor < 35)) throw new Error(`SQLite ${sqliteVersion(db)} is too old; 3.35 or newer is needed.`);
}
