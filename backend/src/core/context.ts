/*
 * The process context: configuration, paths, the two database connections,
 * the write gates, the keys, and what is known about this boot. One is built
 * per process (API, worker, maint, CLI); request handlers get it by closure.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { type Config, type Paths, paths as buildPaths } from '../config.ts';
import { Db, type DbRole, type Param } from './db.ts';
import { sha256Hex } from './ids.ts';
import { nowIso } from './time.ts';
import { WriteGate } from './writeGate.ts';

export type ClockTrust = 'synced' | 'rtc' | 'restored' | 'manual' | 'unsure';

export interface BootInfo {
  bootId: string;
  bootSeq: number;
  /** bag_meta.uptime_total_s as it was when this boot began. */
  uptimeBaseS: number;
  previousClean: boolean;
  startedAt: string;
}

export interface Keys {
  ticket: Buffer;
  pepper: Buffer;
  /** Per-bag override secret (ADR-017); absent on a bag that was not provisioned with one. */
  override: { version: number; key: Buffer } | null;
}

export interface AuditInput {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome?: 'ok' | 'refused' | 'failed' | 'interrupted';
  /** Never names of learners. */
  detail?: Record<string, unknown>;
  clientIp?: string | null;
}

interface RequestStore {
  arrivedAt: number;
}

export const requestStore = new AsyncLocalStorage<RequestStore>();

/** The kernel's id of this boot. Outside Linux (laptops) it is derived from the boot time. */
export function currentBootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    const bootedAt = Math.round((Date.now() / 1000 - os.uptime()) / 60);
    return 'dev-' + sha256Hex(`${os.hostname()}|${bootedAt}`).slice(0, 24);
  }
}

/** Seconds since this boot (CLOCK_BOOTTIME on Linux). */
export function bootUptimeS(): number {
  return Math.floor(os.uptime());
}

/** What a write transaction may do besides plain SQL: one change sequence, content revision, audit. */
export class Tx {
  readonly db: Db;
  private readonly ctx: Ctx;
  private seqValue: number | null = null;
  private contentBumped = false;

  constructor(db: Db, ctx: Ctx) {
    this.db = db;
    this.ctx = ctx;
  }

  /** The change sequence of this transaction (DATABASE §4.6): taken once, stamped on every changed syncable row. */
  seq(): number {
    if (this.seqValue === null) {
      const row = this.db.get<{ value: string | number }>("UPDATE bag_meta SET value = value + 1 WHERE key = 'change_seq' RETURNING value");
      if (!row) throw new Error('bag_meta.change_seq is missing; the bag was not provisioned.');
      this.seqValue = Number(row.value);
    }
    return this.seqValue;
  }

  /** Call when anything a learner can see changed: the ETag of every content answer changes. */
  bumpContentRev(): void {
    if (this.contentBumped) return;
    this.db.run("UPDATE bag_meta SET value = value + 1 WHERE key = 'content_rev'");
    this.contentBumped = true;
  }

  audit(input: AuditInput): void {
    this.db.run(
      `INSERT INTO audit_event (at, boot_id, clock_trust, actor_id, actor_name, action, target_type, target_id, outcome, detail_json, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nowIso(),
      this.ctx.boot.bootId,
      this.ctx.clockTrust(),
      input.actorId ?? null,
      input.actorName ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.outcome ?? 'ok',
      JSON.stringify(input.detail ?? {}),
      input.clientIp ?? null,
    );
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.db.get<T>(sql, ...params);
  }
  all<T>(sql: string, ...params: Param[]): T[] {
    return this.db.all<T>(sql, ...params);
  }
  run(sql: string, ...params: Param[]): number {
    return this.db.run(sql, ...params);
  }
  value<T>(sql: string, ...params: Param[]): T | undefined {
    return this.db.value<T>(sql, ...params);
  }
}

export interface CtxOptions {
  config: Config;
  role: DbRole;
  version: string;
  boot: BootInfo;
  keys: Keys;
}

export class Ctx {
  readonly config: Config;
  readonly paths: Paths;
  readonly version: string;
  readonly boot: BootInfo;
  readonly keys: Keys;
  readonly db: Db;
  readonly counts: Db;
  readonly gate: WriteGate;
  readonly countsGate: WriteGate;
  private clockCache: { at: number; trust: ClockTrust } | null = null;

  constructor(options: CtxOptions) {
    this.config = options.config;
    this.paths = buildPaths(options.config);
    this.version = options.version;
    this.boot = options.boot;
    this.keys = options.keys;
    this.db = new Db(this.paths.mainDb, { role: options.role });
    this.counts = new Db(this.paths.countsDb, { role: options.role });
    this.gate = new WriteGate(this.db);
    this.countsGate = new WriteGate(this.counts);
  }

  /**
   * One write transaction on the main database. In the API it queues behind
   * the write gate and never blocks the event loop on a lock (R-3a); in batch
   * processes the connection's busy_timeout=5000 does the waiting.
   */
  write<T>(fn: (tx: Tx) => T, options: { secureDelete?: boolean } = {}): Promise<T> {
    const arrivedAt = requestStore.getStore()?.arrivedAt;
    return this.gate.run(() => fn(new Tx(this.db, this)), { ...(arrivedAt === undefined ? {} : { arrivedAt }), ...options });
  }

  /** Synchronous variant for batch processes (worker, maint, CLIs), whose connections wait inside SQLite. */
  writeSync<T>(fn: (tx: Tx) => T, options: { secureDelete?: boolean } = {}): T {
    return this.db.tx(() => fn(new Tx(this.db, this)), options);
  }

  writeCounts<T>(fn: (db: Db) => T): Promise<T> {
    const arrivedAt = requestStore.getStore()?.arrivedAt;
    return this.countsGate.run(() => fn(this.counts), arrivedAt === undefined ? {} : { arrivedAt });
  }

  meta(key: string): string | undefined {
    return this.db.value<string>('SELECT value FROM bag_meta WHERE key = ?', key);
  }

  metaInt(key: string, fallback = 0): number {
    const value = this.meta(key);
    return value === undefined ? fallback : Number(value);
  }

  bagName(): string {
    return this.meta('bag_name') ?? this.config.bag.name;
  }

  /** Accumulated uptime of the bag across boots, in seconds (ADR-017). */
  uptimeTotalS(): number {
    return this.boot.uptimeBaseS + bootUptimeS();
  }

  /**
   * How far the wall clock can be believed (ADR-014). Written to run/clock.json
   * by boot recovery and by the clock helper; re-read at most every 5 s.
   */
  clockTrust(): ClockTrust {
    if (this.config.dev.assumeClock) return this.config.dev.assumeClock;
    const now = performance.now();
    if (this.clockCache && now - this.clockCache.at < 5000) return this.clockCache.trust;
    const trust = readClockState(this.paths).trust;
    this.clockCache = { at: now, trust };
    return trust;
  }

  forgetClockCache(): void {
    this.clockCache = null;
  }

  /** `sensitive` portals follow Child protection rules while the mode is counts-only (ADR-009). */
  countsOnly(): boolean {
    return this.config.childProtection.progressMode === 'counts-only';
  }

  inMaintenance(): boolean {
    return existsSync(this.paths.maintenanceFlag);
  }

  close(): void {
    this.db.close();
    this.counts.close();
  }
}

export interface ClockState {
  trust: ClockTrust;
  /** A hub manager set the date by hand and no independent source (NTP) has confirmed it since (V-039). */
  handSetUnconfirmed: boolean;
  /** A change that was recorded before it was applied; boot recovery finishes the bookkeeping (V-039). */
  pending: { from: string; to: string; by: string | null; recordedAt: string } | null;
}

export function readClockState(p: Paths): ClockState {
  try {
    const raw = JSON.parse(readFileSync(p.clockJson, 'utf8')) as Partial<ClockState>;
    const trust: ClockTrust = raw.trust === 'synced' || raw.trust === 'rtc' || raw.trust === 'restored' || raw.trust === 'manual' ? raw.trust : 'unsure';
    return { trust, handSetUnconfirmed: raw.handSetUnconfirmed === true, pending: raw.pending ?? null };
  } catch {
    return { trust: 'unsure', handSetUnconfirmed: false, pending: null };
  }
}

/** Trusted for expiry decisions: only a synchronised clock or a battery-backed RTC, never a hand-set date. */
export function clockIsTrusted(trust: ClockTrust): boolean {
  return trust === 'synced' || trust === 'rtc';
}

export function loadKeys(p: Paths): Keys {
  const read = (name: string): Buffer => {
    const file = `${p.keys}/${name}`;
    const mode = statSync(file).mode & 0o077;
    if (mode !== 0 && process.platform === 'linux') throw new Error(`${file} must not be readable by other users (chmod 600).`);
    return readFileSync(file);
  };
  const ticket = read('ticket.key');
  const pepper = read('session.pepper');
  if (ticket.length < 32 || pepper.length < 32) throw new Error('The bag keys are too short; provision the bag again.');
  let override: Keys['override'] = null;
  if (existsSync(`${p.keys}/override.key`)) {
    const parsed = JSON.parse(read('override.key').toString('utf8')) as { version?: unknown; key?: unknown };
    if (typeof parsed.version !== 'number' || typeof parsed.key !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.key)) throw new Error('override.key is not valid.');
    override = { version: parsed.version, key: Buffer.from(parsed.key, 'hex') };
  }
  return { ticket, pepper, override };
}

/** boot.json is written by boot recovery; it must describe the boot we are in. */
export function readBootInfo(p: Paths): BootInfo | null {
  try {
    const raw = JSON.parse(readFileSync(p.bootJson, 'utf8')) as BootInfo;
    if (raw.bootId !== currentBootId()) return null;
    if (typeof raw.bootSeq !== 'number' || typeof raw.uptimeBaseS !== 'number') return null;
    return raw;
  } catch {
    return null;
  }
}
