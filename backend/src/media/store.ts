/*
 * The content-addressed media store (ADR-005): immutable files named by their
 * SHA-256 under media/c/<aa>/ (originals) and media/d/<aa>/ (derived). A file
 * is moved in only when complete: fsync(file) → rename → fsync(directory);
 * then one short transaction records it in `blob`. A file without a row is an
 * orphan and is moved aside at boot (DATA-EXPORT §13 step 9).
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, linkSync, renameSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Paths } from '../config.ts';
import type { Tx } from '../core/context.ts';
import { ensureDir, fsyncDir, fsyncFile } from '../core/fsx.ts';
import { nowIso } from '../core/time.ts';

export const BLOB_EXTS = ['mp4', 'm4a', 'mp3', 'ogg', 'opus', 'webm', 'jpg', 'png', 'webp', 'vtt', 'pdf', 'json', 'txt'];

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  vtt: 'text/vtt',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
};

export type Origin = 'upload' | 'derived' | 'content-pack' | 'builtin';

export interface StoredBlob {
  sha256: string;
  sizeBytes: number;
  ext: string;
  mimeType: string;
  relPath: string;
  origin: Origin;
}

export function blobRelPath(sha256: string, ext: string, origin: Origin): string {
  if (!/^[0-9a-f]{64}$/.test(sha256) || BLOB_EXTS.indexOf(ext) === -1) throw new Error('Not a storable file.');
  return `${origin === 'derived' ? 'd' : 'c'}/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}

export function hashFile(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let size = 0;
    createReadStream(path, { highWaterMark: 1024 * 1024 })
      .on('data', (chunk) => {
        size += chunk.length;
        hash.update(chunk);
      })
      .on('error', reject)
      .on('end', () => resolve({ sha256: hash.digest('hex'), sizeBytes: size }));
  });
}

/** The first bytes of a file, for sniffing. */
export async function headOf(path: string, bytes = 16): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Put a complete file into the store. `move` renames it (it must be on the
 * same filesystem: uploads, jobs/tmp and media all live under the data
 * directory); otherwise it is copied. An identical file already in the store
 * is kept and the new one dropped (de-duplication).
 */
export async function storeFile(p: Paths, file: string, sha256: string, sizeBytes: number, ext: string, origin: Origin, move: boolean | 'link'): Promise<StoredBlob> {
  const relPath = blobRelPath(sha256, ext, origin);
  const dest = join(p.media, relPath);
  ensureDir(dirname(dest), 0o755);
  let present = false;
  try {
    present = statSync(dest).size === sizeBytes;
  } catch {
    present = false;
  }
  if (present) {
    if (move === true) rmSync(file, { force: true });
  } else {
    const staging = `${dest}.incoming-${process.pid}`;
    rmSync(staging, { force: true });
    if (move === true) renameSync(file, staging);
    else if (move === 'link') {
      // A second name for the same bytes: the source stays where it is until its owner removes it, and nothing is copied.
      try {
        linkSync(file, staging);
      } catch {
        copyFileSync(file, staging);
      }
    } else copyFileSync(file, staging);
    await fsyncFile(staging);
    renameSync(staging, dest);
    fsyncDir(dirname(dest));
  }
  return { sha256, sizeBytes, ext, mimeType: MIME[ext] ?? 'application/octet-stream', relPath, origin };
}

/** Record a stored file. Run inside the transaction that starts using it. */
export function insertBlob(tx: Tx, blob: StoredBlob): void {
  tx.run(
    `INSERT INTO blob (sha256, size_bytes, ext, mime_type, rel_path, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sha256) DO UPDATE SET unreferenced_since = NULL`,
    blob.sha256,
    blob.sizeBytes,
    blob.ext,
    blob.mimeType,
    blob.relPath,
    blob.origin,
    nowIso(),
  );
}

export function blobFileExists(p: Paths, relPath: string): boolean {
  return existsSync(join(p.media, relPath));
}

/**
 * Where an identical file already sits in the store (any origin), so the same
 * bytes are never stored under two paths: `blob.sha256` is the primary key.
 */
export function existingBlob(tx: { get: Tx['get'] }, sha256: string): StoredBlob | null {
  const row = tx.get<{ sha256: string; size_bytes: number; ext: string; mime_type: string; rel_path: string; origin: Origin }>('SELECT * FROM blob WHERE sha256 = ?', sha256);
  return row ? { sha256: row.sha256, sizeBytes: row.size_bytes, ext: row.ext, mimeType: row.mime_type, relPath: row.rel_path, origin: row.origin } : null;
}
