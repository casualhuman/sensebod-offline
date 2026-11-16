/*
 * A small, strict zip reader for animation packages and .docx files
 * (SYSTEM-ARCHITECTURE §5.4, T-4). It reads the central directory and
 * extracts with bounds on everything an attacker controls:
 *   - entry names: no absolute paths, no "..", no backslashes, no symlinks (zip-slip)
 *   - at most 2,000 entries; a cap on the total unpacked size
 *   - a compression ratio above 100:1 is refused (zip bombs)
 *   - only "stored" and "deflate"; no encryption, no zip64, no multi-disk
 * Each entry is inflated through a stream with a hard byte limit, so the
 * declared sizes are never trusted.
 */
import { closeSync, createReadStream, createWriteStream, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  directory: boolean;
}

export const MAX_ENTRIES = 2000;
export const MAX_RATIO = 100;

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buffer, done, length - done, position + done);
    if (n === 0) throw new ZipError('The zip file is cut off.');
    done += n;
  }
  return buffer;
}

export function safeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 240) return false;
  if (name.startsWith('/') || name.indexOf('\\') !== -1 || name.indexOf('\0') !== -1 || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((part, index, all) => (part !== '' || index === all.length - 1) && part !== '..' && part !== '.');
}

/** List the entries of a zip file. Throws ZipError for anything outside the accepted subset. */
export function listZip(file: string): ZipEntry[] {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size < 22) throw new ZipError('This is not a zip file.');
    const tailLength = Math.min(size, 65_557);
    const tail = readAt(fd, size - tailLength, tailLength);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd === -1) throw new ZipError('This is not a zip file.');
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (tail.readUInt16LE(eocd + 4) !== 0 || total === 0xffff || cdOffset === 0xffffffff) throw new ZipError('This kind of zip file (zip64 or split) is not supported.');
    if (total > MAX_ENTRIES) throw new ZipError('The zip file has too many files inside.');
    if (cdOffset + cdSize > size) throw new ZipError('The zip file is damaged.');
    const cd = readAt(fd, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let i = 0; i < total; i += 1) {
      if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) throw new ZipError('The zip file is damaged.');
      const flags = cd.readUInt16LE(at + 8);
      const method = cd.readUInt16LE(at + 10);
      const compressedSize = cd.readUInt32LE(at + 20);
      const uncompressed = cd.readUInt32LE(at + 24);
      const nameLength = cd.readUInt16LE(at + 28);
      const extraLength = cd.readUInt16LE(at + 30);
      const commentLength = cd.readUInt16LE(at + 32);
      const external = cd.readUInt32LE(at + 38);
      const localOffset = cd.readUInt32LE(at + 42);
      const name = cd.toString('utf8', at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      if (flags & 0x1) throw new ZipError('The zip file is protected with a password.');
      if (method !== 0 && method !== 8) throw new ZipError('The zip file uses a kind of packing the bag cannot open.');
      // Unix file type in the high bits: refuse symbolic links.
      if (((external >>> 16) & 0o170000) === 0o120000) throw new ZipError('The zip file holds a link, which is not allowed.');
      if (!safeEntryName(name)) throw new ZipError('The zip file holds a file with an unsafe name.');
      if (compressedSize === 0xffffffff || uncompressed === 0xffffffff) throw new ZipError('This kind of zip file (zip64) is not supported.');
      entries.push({ name, method, compressedSize, size: uncompressed, localOffset, directory: name.endsWith('/') });
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

function dataOffset(fd: number, entry: ZipEntry): number {
  const header = readAt(fd, entry.localOffset, 30);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new ZipError('The zip file is damaged.');
  return entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}

function limiter(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) callback(new ZipError('A file inside the zip is larger than it says.'));
      else callback(null, chunk);
    },
  });
}

/** The bytes of one entry, read through a hard limit. For small members such as a .docx's document.xml. */
export async function readEntry(file: string, entry: ZipEntry, maxBytes: number): Promise<Buffer> {
  if (entry.size > maxBytes) throw new ZipError('A file inside the zip is too large.');
  const fd = openSync(file, 'r');
  let start: number;
  try {
    start = dataOffset(fd, entry);
  } finally {
    closeSync(fd);
  }
  if (entry.compressedSize === 0) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  const sink = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const source = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 8) await pipeline(source, createInflateRaw(), limiter(maxBytes), sink);
  else await pipeline(source, limiter(maxBytes), sink);
  return Buffer.concat(chunks);
}

export interface ExtractLimits {
  maxTotalBytes: number;
}

/** Unpack every entry under `destDir` (which must be new). Returns the number of bytes written. */
export async function extractZip(file: string, entries: ZipEntry[], destDir: string, limits: ExtractLimits): Promise<number> {
  const declared = entries.reduce((sum, e) => sum + e.size, 0);
  const packed = entries.reduce((sum, e) => sum + e.compressedSize, 0);
  if (declared > limits.maxTotalBytes) throw new ZipError('The animation is too large when unpacked.');
  if (packed > 0 && declared / packed > MAX_RATIO) throw new ZipError('The zip file unpacks to far more than its size, which is not allowed.');
  let written = 0;
  const fd = openSync(file, 'r');
  try {
    for (const entry of entries) {
      const target = join(destDir, entry.name);
      // Belt and braces after safeEntryName: the resolved path must stay inside destDir.
      if (!target.startsWith(destDir + '/')) throw new ZipError('The zip file holds a file with an unsafe name.');
      if (entry.directory) {
        mkdirSync(target, { recursive: true, mode: 0o755 });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
      const left = limits.maxTotalBytes - written;
      const cap = Math.min(left, Math.max(entry.size, 1));
      const out = createWriteStream(target, { flags: 'wx', mode: 0o644 });
      if (entry.compressedSize === 0) {
        await new Promise<void>((resolve, reject) => out.end(() => resolve()).on('error', reject));
        continue;
      }
      const start = dataOffset(fd, entry);
      const source = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          callback(null, chunk);
        },
      });
      if (entry.method === 8) await pipeline(source, createInflateRaw(), limiter(cap), counter, out);
      else await pipeline(source, limiter(cap), counter, out);
    }
  } finally {
    closeSync(fd);
  }
  return written;
}
