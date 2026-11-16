/*
 * The USB stick as the API sees it (DATA-EXPORT §10). Mounting, checking,
 * repairing, ejecting and formatting are done by root helpers; this module
 * only reads what the mount helper wrote to /run/sensebod-offline/usb.json and looks
 * inside SENSEBOD-OFFLINE/ on the mounted stick.
 *
 * Reads of the stick use asynchronous file calls with a time limit: a dead
 * stick may hang a thread of the pool, never the event loop.
 */
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import type { Ctx } from '../core/context.ts';

export type UsbStateName = 'none' | 'mounted' | 'read-only' | 'errors' | 'unreadable' | 'busy' | 'not-answering' | 'ejected';

/** What sensebod-offline-usb@ writes. Unknown or missing values are treated as "not known". */
export interface UsbJson {
  state?: string;
  kernelName?: string;
  label?: string | null;
  filesystem?: string | null;
  totalBytes?: number | null;
  freeBytes?: number | null;
  dirtyNote?: boolean;
  repaired?: boolean;
  stick?: { label?: string; formattedBy?: string } | null;
  lastAddAtBootS?: number;
}

const STATES: UsbStateName[] = ['none', 'mounted', 'read-only', 'errors', 'unreadable', 'busy', 'not-answering', 'ejected'];

export async function readUsbJson(ctx: Ctx): Promise<UsbJson | null> {
  try {
    return JSON.parse(await readFile(ctx.paths.usbJson, 'utf8')) as UsbJson;
  } catch {
    return null;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function stickRoot(ctx: Ctx): string {
  return join(ctx.paths.usbMount, 'SENSEBOD-OFFLINE');
}

interface BackupEntry {
  bagId: string;
  bagName: string;
  createdAt: string;
  scope: 'records' | 'full';
}

interface PackageEntry {
  name: string;
  kind: 'update' | 'content-pack';
  version: string;
  signatureOk: boolean;
}

async function listBackups(ctx: Ctx): Promise<BackupEntry[]> {
  const root = stickRoot(ctx);
  const out: BackupEntry[] = [];
  for (const name of await readdir(root)) {
    if (!/^[0-9a-f-]{8,64}$/.test(name)) continue;
    try {
      const latest = JSON.parse(await readFile(join(root, name, 'LATEST.json'), 'utf8')) as Partial<BackupEntry>;
      if (typeof latest.createdAt === 'string') out.push({ bagId: name, bagName: String(latest.bagName ?? ''), createdAt: latest.createdAt, scope: latest.scope === 'full' ? 'full' : 'records' });
    } catch {
      // no complete backup of that bag on this stick
    }
  }
  return out;
}

/** `ssh-keygen -Y verify` with the bag's allowed_signers; the namespace separates releases, packs and the registry. */
export type SignatureNamespace = 'sensebod-offline-release' | 'sensebod-offline-content' | 'sensebod-offline-registry';

/** 'unknown' = the check did not finish (time limit, unreadable file): not a verdict, never cached. */
export function checkSignature(ctx: { config: Config }, file: string, signatureFile: string, namespace: SignatureNamespace, identity: string): Promise<'ok' | 'bad' | 'unknown'> {
  return new Promise((resolve) => {
    // Streamed: a release bundle is hundreds of megabytes and must never sit in the API's memory.
    const input = createReadStream(file);
    const child = execFile(
      ctx.config.tools.sshKeygen,
      ['-Y', 'verify', '-f', ctx.config.paths.allowedSignersFile, '-I', identity, '-n', namespace, '-s', signatureFile],
      { timeout: 20_000 },
      (error) => {
        // The tool may leave before it has read everything: the file on the stick must not stay open.
        input.destroy();
        resolve(!error ? 'ok' : error.killed || typeof (error as { code?: unknown }).code !== 'number' ? 'unknown' : 'bad');
      },
    );
    input.on('error', () => {
      child.kill();
      resolve('unknown');
    });
    child.stdin?.on('error', () => undefined);
    if (child.stdin) input.pipe(child.stdin);
  });
}

/** `ssh-keygen -Y verify` with the bag's allowed_signers. Anything but a completed, successful check is false. */
export async function verifySignature(ctx: { config: Config }, file: string, signatureFile: string, namespace: SignatureNamespace, identity: string): Promise<boolean> {
  return (await checkSignature(ctx, file, signatureFile, namespace, identity)) === 'ok';
}

export const PACK_DIR = /^sensebod-offline-pack-([a-z0-9-]{1,48})-([0-9A-Za-z._]{1,24})$/;
export const RELEASE_FILE = /^sensebod-offline-release-([0-9A-Za-z._-]{1,48})\.tar$/;

const signatureCache = new Map<string, boolean>();

async function listPackages(ctx: Ctx): Promise<PackageEntry[]> {
  const mount = ctx.paths.usbMount;
  const out: PackageEntry[] = [];
  for (const name of await readdir(mount)) {
    const pack = PACK_DIR.exec(name);
    const release = RELEASE_FILE.exec(name);
    if (!pack && !release) continue;
    const signed = pack ? join(mount, name, 'manifest.json') : join(mount, name);
    const signature = `${signed}.sig`;
    let key = '';
    try {
      const [a, b] = await Promise.all([stat(signed), stat(signature)]);
      key = `${name}|${a.size}|${a.mtimeMs}|${b.size}|${b.mtimeMs}`;
    } catch {
      out.push({ name, kind: pack ? 'content-pack' : 'update', version: String((pack ?? release)?.[pack ? 2 : 1] ?? ''), signatureOk: false });
      continue;
    }
    let ok = signatureCache.get(key);
    if (ok === undefined) {
      const verdict = await checkSignature(ctx, signed, signature, pack ? 'sensebod-offline-content' : 'sensebod-offline-release', pack ? 'content@easystem' : 'release@easystem');
      ok = verdict === 'ok';
      if (signatureCache.size > 50) signatureCache.clear();
      if (verdict !== 'unknown') signatureCache.set(key, ok);
    }
    out.push({ name, kind: pack ? 'content-pack' : 'update', version: String((pack ?? release)?.[pack ? 2 : 1] ?? ''), signatureOk: ok });
  }
  return out;
}

/** Which stick to use for the next full backup: the one that did not get the last one (DATA-EXPORT §10.3). */
function rotationHint(ctx: Ctx): 'A' | 'B' | null {
  const last = ctx.db.value<string>("SELECT value_json FROM setting WHERE key = 'usb.last_full_backup_label'");
  if (last === '"A"') return 'B';
  if (last === '"B"') return 'A';
  return null;
}

export async function usbState(ctx: Ctx) {
  const json = await readUsbJson(ctx);
  const usbJobStuck = ctx.db.value<string>("SELECT value_json FROM setting WHERE key = 'usb.lane_stuck'") === 'true';
  let state: UsbStateName = json && STATES.indexOf(json.state as UsbStateName) !== -1 ? (json.state as UsbStateName) : 'none';
  if (usbJobStuck && state !== 'none' && state !== 'ejected') state = 'not-answering';
  const readable = state === 'mounted' || state === 'read-only' || state === 'errors';
  const sensebodOfflineLabel = json?.stick?.label === 'SENSEBOD-A' ? 'A' : json?.stick?.label === 'SENSEBOD-B' ? 'B' : null;
  const filesystem = json?.filesystem === 'vfat' || json?.filesystem === 'exfat' ? json.filesystem : null;
  return {
    state,
    label: readable ? (json?.label ?? null) : null,
    filesystem: readable ? filesystem : null,
    totalBytes: readable && typeof json?.totalBytes === 'number' ? json.totalBytes : null,
    freeBytes: readable && typeof json?.freeBytes === 'number' ? json.freeBytes : null,
    backups: readable ? await withTimeout(listBackups(ctx), 3000, [] as BackupEntry[]) : [],
    packages: readable ? await withTimeout(listPackages(ctx), 25_000, [] as PackageEntry[]) : [],
    dirtyNote: readable && json?.dirtyNote === true,
    repaired: readable && json?.repaired === true,
    sensebodOfflineLabel: readable ? sensebodOfflineLabel : null,
    rotationHint: rotationHint(ctx),
  };
}

/** The stick can be written to right now. */
export async function usbWritable(ctx: Ctx): Promise<{ ok: boolean; json: UsbJson | null }> {
  const json = await readUsbJson(ctx);
  return { ok: json?.state === 'mounted', json };
}
