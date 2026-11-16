/*
 * Configuration (R-7): read /etc/sensebod-offline/sensebod-offline.toml once at start and
 * refuse to start on unknown or invalid keys. Values an admin may change live
 * in the `setting` table, not here. The Child protection mode is here only
 * (V-014): it is release / technician configuration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';

export interface Config {
  bag: { name: string };
  server: { host: string; port: number; allowedHosts: string[]; trustProxy: boolean; maxInFlight: number; maxUploadStreams: number };
  paths: { dataDir: string; runDir: string; webDir: string | null; recipientsFile: string; allowedSignersFile: string };
  limits: {
    uploadMaxBytes: number;
    chunkMaxBytes: number;
    chunkBytes: number;
    pictureMaxBytes: number;
    packageMaxBytes: number;
    reserveBytes: number;
    lowBytes: number;
    inPageDownloadMaxBytes: number;
    maxAdminAccounts: number;
  };
  uploads: { singleMaxBytes: number; h5pPlayer: boolean };
  session: { bindIp: boolean; idleMinutes: number; absoluteMinutes: number };
  childProtection: { progressMode: 'counts-only' | 'per-learner' };
  retention: { learnerDays: number; unexportedHoldDays: number; maxShareWithoutConfirm: number };
  exports: { learnerTtlHours: number; backupTtlHours: number; diagnosticsTtlHours: number; ticketMinutes: number };
  tools: { ffmpeg: string; ffprobe: string; pdftoppm: string; pdfinfo: string; age: string; sshKeygen: string; systemctl: string };
  dev: { selfRecover: boolean; serveFiles: boolean; assumeClock: 'synced' | 'rtc' | 'unsure' | null; fakePrivileged: boolean };
}

type Kind = 'string' | 'int' | 'bool' | 'strings';
interface Field {
  kind: Kind;
  def: unknown;
  oneOf?: readonly string[];
  min?: number;
  nullable?: boolean;
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Every key the file may hold, with its default. Anything else stops the start. */
const SCHEMA: Record<string, Record<string, Field>> = {
  bag: { name: { kind: 'string', def: 'Sensebod Offline bag' } },
  server: {
    host: { kind: 'string', def: '127.0.0.1' },
    port: { kind: 'int', def: 8000, min: 1 },
    allowed_hosts: { kind: 'strings', def: ['materials.sensebod.com', '10.10.0.1', '10.20.0.1'] },
    trust_proxy: { kind: 'bool', def: true },
    max_in_flight: { kind: 'int', def: 64, min: 1 },
    max_upload_streams: { kind: 'int', def: 4, min: 1 },
  },
  paths: {
    data_dir: { kind: 'string', def: '/var/lib/sensebod-offline' },
    run_dir: { kind: 'string', def: '/run/sensebod-offline' },
    web_dir: { kind: 'string', def: null, nullable: true },
    recipients_file: { kind: 'string', def: '/etc/sensebod-offline/backup-recipients.txt' },
    allowed_signers_file: { kind: 'string', def: '/etc/sensebod-offline/allowed_signers' },
  },
  limits: {
    upload_max_bytes: { kind: 'int', def: 2 * GIB, min: 1 },
    chunk_max_bytes: { kind: 'int', def: 4 * MIB, min: 1024 },
    chunk_bytes: { kind: 'int', def: 2 * MIB, min: 1024 },
    picture_max_bytes: { kind: 'int', def: 10 * MIB, min: 1024 },
    package_max_bytes: { kind: 'int', def: 200 * MIB, min: 1024 },
    reserve_bytes: { kind: 'int', def: 2 * GIB, min: 0 },
    low_bytes: { kind: 'int', def: 10 * GIB, min: 0 },
    in_page_download_max_bytes: { kind: 'int', def: 16 * MIB, min: 1024 },
    max_admin_accounts: { kind: 'int', def: 10, min: 1 },
  },
  uploads: {
    // Transition (API-DECISIONS D-6.2b): 2 GiB until the frontend ships resumable uploads, then 16 MiB.
    single_max_bytes: { kind: 'int', def: 2 * GIB, min: 1024 },
    h5p_player: { kind: 'bool', def: false },
  },
  session: {
    bind_ip: { kind: 'bool', def: true },
    idle_minutes: { kind: 'int', def: 120, min: 1 },
    absolute_minutes: { kind: 'int', def: 720, min: 1 },
  },
  child_protection: { progress_mode: { kind: 'string', def: 'counts-only', oneOf: ['counts-only', 'per-learner'] } },
  retention: {
    learner_days: { kind: 'int', def: 61, min: 1 },
    // Owner decision O-16 (13 Nov 2026): unexported data is held 60 extra days, then removed.
    unexported_hold_days: { kind: 'int', def: 60, min: 0 },
    max_share_without_confirm_percent: { kind: 'int', def: 10, min: 1 },
  },
  exports: {
    learner_ttl_hours: { kind: 'int', def: 24, min: 1 },
    backup_ttl_hours: { kind: 'int', def: 72, min: 1 },
    diagnostics_ttl_hours: { kind: 'int', def: 72, min: 1 },
    ticket_minutes: { kind: 'int', def: 30, min: 1 },
  },
  tools: {
    ffmpeg: { kind: 'string', def: 'ffmpeg' },
    ffprobe: { kind: 'string', def: 'ffprobe' },
    pdftoppm: { kind: 'string', def: 'pdftoppm' },
    pdfinfo: { kind: 'string', def: 'pdfinfo' },
    age: { kind: 'string', def: 'age' },
    ssh_keygen: { kind: 'string', def: 'ssh-keygen' },
    systemctl: { kind: 'string', def: 'systemctl' },
  },
  // Laptop-only switches. A bag's file has no [dev] table.
  dev: {
    self_recover: { kind: 'bool', def: false },
    serve_files: { kind: 'bool', def: false },
    assume_clock: { kind: 'string', def: null, nullable: true, oneOf: ['synced', 'rtc', 'unsure'] },
    fake_privileged: { kind: 'bool', def: false },
  },
};

export class ConfigError extends Error {}

function check(table: string, key: string, field: Field, value: unknown): unknown {
  const where = `[${table}] ${key}`;
  if (value === undefined) return field.def;
  if (field.kind === 'string') {
    if (typeof value !== 'string' || value === '') throw new ConfigError(`${where} must be text.`);
    if (field.oneOf && field.oneOf.indexOf(value) === -1) throw new ConfigError(`${where} must be one of: ${field.oneOf.join(', ')}.`);
  } else if (field.kind === 'int') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new ConfigError(`${where} must be a whole number.`);
    if (field.min !== undefined && value < field.min) throw new ConfigError(`${where} must be at least ${field.min}.`);
  } else if (field.kind === 'bool') {
    if (typeof value !== 'boolean') throw new ConfigError(`${where} must be true or false.`);
  } else if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string' || v === '')) {
    throw new ConfigError(`${where} must be a list of text values.`);
  }
  return value;
}

/** Validate a parsed TOML document. Exported for tests. */
export function buildConfig(doc: Record<string, unknown>): Config {
  const out: Record<string, Record<string, unknown>> = {};
  for (const table of Object.keys(doc)) {
    if (!SCHEMA[table]) throw new ConfigError(`Unknown table [${table}] in the configuration.`);
    const given = doc[table];
    if (!given || typeof given !== 'object' || Array.isArray(given)) throw new ConfigError(`[${table}] must be a table.`);
    for (const key of Object.keys(given)) {
      if (!SCHEMA[table][key]) throw new ConfigError(`Unknown key [${table}] ${key} in the configuration.`);
    }
  }
  for (const [table, fields] of Object.entries(SCHEMA)) {
    const given = (doc[table] ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(fields)) values[key] = check(table, key, field, given[key]);
    out[table] = values;
  }
  // The [dev] switches weaken a bag (the API serving files itself, pretend root helpers, an assumed clock).
  // They are honoured only when the process was started for development on purpose.
  const dev = out.dev as Record<string, unknown>;
  const devUsed = dev.self_recover === true || dev.serve_files === true || dev.fake_privileged === true || dev.assume_clock !== null;
  if (devUsed && process.env.SENSEBOD_OFFLINE_DEV !== '1') throw new ConfigError('The [dev] switches are for laptops only. Remove the [dev] table from this configuration.');
  const v = <T>(table: string, key: string): T => (out[table] as Record<string, unknown>)[key] as T;
  return {
    bag: { name: v('bag', 'name') },
    server: {
      host: v('server', 'host'),
      port: v('server', 'port'),
      allowedHosts: v<string[]>('server', 'allowed_hosts').map((h) => h.toLowerCase()),
      trustProxy: v('server', 'trust_proxy'),
      maxInFlight: v('server', 'max_in_flight'),
      maxUploadStreams: v('server', 'max_upload_streams'),
    },
    paths: {
      dataDir: v('paths', 'data_dir'),
      runDir: v('paths', 'run_dir'),
      webDir: v('paths', 'web_dir'),
      recipientsFile: v('paths', 'recipients_file'),
      allowedSignersFile: v('paths', 'allowed_signers_file'),
    },
    limits: {
      uploadMaxBytes: v('limits', 'upload_max_bytes'),
      chunkMaxBytes: v('limits', 'chunk_max_bytes'),
      chunkBytes: v('limits', 'chunk_bytes'),
      pictureMaxBytes: v('limits', 'picture_max_bytes'),
      packageMaxBytes: v('limits', 'package_max_bytes'),
      reserveBytes: v('limits', 'reserve_bytes'),
      lowBytes: v('limits', 'low_bytes'),
      inPageDownloadMaxBytes: v('limits', 'in_page_download_max_bytes'),
      maxAdminAccounts: v('limits', 'max_admin_accounts'),
    },
    uploads: { singleMaxBytes: v('uploads', 'single_max_bytes'), h5pPlayer: v('uploads', 'h5p_player') },
    session: { bindIp: v('session', 'bind_ip'), idleMinutes: v('session', 'idle_minutes'), absoluteMinutes: v('session', 'absolute_minutes') },
    childProtection: { progressMode: v('child_protection', 'progress_mode') },
    retention: {
      learnerDays: v('retention', 'learner_days'),
      unexportedHoldDays: v('retention', 'unexported_hold_days'),
      maxShareWithoutConfirm: v<number>('retention', 'max_share_without_confirm_percent') / 100,
    },
    exports: {
      learnerTtlHours: v('exports', 'learner_ttl_hours'),
      backupTtlHours: v('exports', 'backup_ttl_hours'),
      diagnosticsTtlHours: v('exports', 'diagnostics_ttl_hours'),
      ticketMinutes: v('exports', 'ticket_minutes'),
    },
    tools: {
      ffmpeg: v('tools', 'ffmpeg'),
      ffprobe: v('tools', 'ffprobe'),
      pdftoppm: v('tools', 'pdftoppm'),
      pdfinfo: v('tools', 'pdfinfo'),
      age: v('tools', 'age'),
      sshKeygen: v('tools', 'ssh_keygen'),
      systemctl: v('tools', 'systemctl'),
    },
    dev: {
      selfRecover: v('dev', 'self_recover'),
      serveFiles: v('dev', 'serve_files'),
      assumeClock: v('dev', 'assume_clock'),
      fakePrivileged: v('dev', 'fake_privileged'),
    },
  };
}

export const DEFAULT_CONFIG_PATH = '/etc/sensebod-offline/sensebod-offline.toml';

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): Config {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`The configuration file ${path} could not be read: ${(error as Error).message}`);
  }
  let doc: Record<string, unknown>;
  try {
    doc = parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError(`The configuration file ${path} is not valid TOML: ${(error as Error).message}`);
  }
  return buildConfig(doc);
}

/** `--config <path>` from the command line, or the default. */
export function configPathFromArgv(argv: string[] = process.argv): string {
  const at = argv.indexOf('--config');
  const value = at === -1 ? undefined : argv[at + 1];
  return value ?? process.env.SENSEBOD_OFFLINE_CONFIG ?? DEFAULT_CONFIG_PATH;
}

/** Every path the backend uses under the data and run directories (SYSTEM-ARCHITECTURE §8.1). */
export function paths(config: Config) {
  const d = config.paths.dataDir;
  const r = config.paths.runDir;
  return {
    data: d,
    run: r,
    dbDir: join(d, 'db'),
    mainDb: join(d, 'db', 'sensebod-offline.sqlite3'),
    countsDb: join(d, 'db', 'counts.sqlite3'),
    media: join(d, 'media'),
    mediaOrphans: join(d, 'media', '.orphans'),
    tryit: join(d, 'media', 'tryit'),
    uploadsPartial: join(d, 'uploads', '.partial'),
    exports: join(d, 'exports'),
    exportsTmp: join(d, 'exports', '.tmp'),
    snapshots: join(d, 'snapshots'),
    jobsTmp: join(d, 'jobs', 'tmp'),
    keys: join(d, 'keys'),
    state: join(d, 'run'),
    cleanShutdownMarker: join(d, 'run', 'clean-shutdown'),
    clockJson: join(d, 'run', 'clock.json'),
    bootJson: join(d, 'run', 'boot.json'),
    update: join(d, 'update'),
    restore: join(d, 'restore'),
    tmp: join(d, 'tmp'),
    exportSecrets: join(r, 'export-secrets'),
    requests: join(r, 'requests'),
    usbMount: join(r, 'usb'),
    usbJson: join(r, 'usb.json'),
    maintenanceFlag: join(r, 'maintenance'),
  };
}

export type Paths = ReturnType<typeof paths>;
