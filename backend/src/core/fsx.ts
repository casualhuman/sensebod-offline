/* Durable file helpers: a file is only "there" after fsync(file) → rename → fsync(directory). */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync, rmSync, statfsSync, readdirSync, lstatSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch (error) {
    // Some filesystems (FAT on a stick) refuse to fsync a directory; that is not a failure of the write.
    // Anything else (EIO from a dying card, a missing directory) must be seen by the caller.
    const code = (error as { code?: string }).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EISDIR' && code !== 'EPERM' && code !== 'EACCES') throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Write a small file so that after a power cut it is either the old or the new content, never a mix. */
export function writeFileDurable(path: string, data: string | Buffer, mode = 0o600): void {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w', mode);
  try {
    // writeSync may write fewer bytes than asked; keep going until everything is written.
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    for (let done = 0; done < bytes.length; ) done += writeSync(fd, bytes, done, bytes.length - done);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

export function renameDurable(from: string, to: string): void {
  renameSync(from, to);
  fsyncDir(dirname(to));
  if (dirname(from) !== dirname(to)) fsyncDir(dirname(from));
}

export async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function ensureDir(dir: string, mode = 0o700): void {
  mkdirSync(dir, { recursive: true, mode });
}

export function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export interface Space {
  totalBytes: number;
  /** Free for an unprivileged user (root-reserved blocks excluded). */
  availableBytes: number;
}

export function diskSpace(dir: string): Space | null {
  try {
    const s = statfsSync(dir);
    return { totalBytes: Number(s.blocks) * Number(s.bsize), availableBytes: Number(s.bavail) * Number(s.bsize) };
  } catch {
    return null;
  }
}

/** Total size of the regular files under `dir` (not followed through symlinks). */
export function dirBytes(dir: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const s = lstatSync(full, { throwIfNoEntry: false });
      if (!s) continue;
      if (s.isDirectory()) total += dirBytes(full);
      else if (s.isFile()) total += s.size;
    } catch {
      // vanished meanwhile
    }
  }
  return total;
}
