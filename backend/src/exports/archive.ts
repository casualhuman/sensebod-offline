/*
 * Archive writers that need nothing but node:crypto and node:zlib (R-8, ADR-008).
 *
 * Zip: WinZip AES-256, AE-2 (PBKDF2-HMAC-SHA1 1000 rounds → AES key, HMAC key,
 * 2-byte verifier; AES-256 CTR with the WinZip little-endian counter from 1;
 * HMAC-SHA1 over the ciphertext, first 10 bytes kept; CRC field 0). The
 * password is a function argument: it is never on a command line or in the
 * environment of any process. Interoperability with libarchive was shown in
 * docs/system/poc/poc_ae2.out; 7-Zip and ZArchiver are P-2 on real devices.
 * Without a password the same writer makes an ordinary deflate zip with CRC-32
 * (diagnostics).
 *
 * Tar: plain POSIX ustar, streamed to a writable (the stdin of `age`).
 *
 * CSV: UTF-8 with BOM, CRLF, RFC 4180 quoting, and a guard against formula
 * injection (names are typed by learners).
 */
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, fsyncSync, openSync, statSync, writeSync } from 'node:fs';
import type { Writable } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';

/* ------------------------------------------------------------------ */
/* zip                                                                 */
/* ------------------------------------------------------------------ */

/** AES-256 in CTR mode with WinZip's little-endian block counter starting at 1. */
export function winzipCtr(key: Buffer, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.length);
  const ecb = createCipheriv('aes-256-ecb', key, null);
  ecb.setAutoPadding(false);
  const BLOCKS = 4096;
  let block = 1;
  for (let offset = 0; offset < data.length; offset += BLOCKS * 16) {
    const count = Math.min(BLOCKS, Math.ceil((data.length - offset) / 16));
    const counters = Buffer.alloc(count * 16);
    for (let i = 0; i < count; i += 1, block += 1) counters.writeUIntLE(block, i * 16, 6);
    const stream = ecb.update(counters);
    const end = Math.min(data.length, offset + count * 16);
    for (let i = offset; i < end; i += 1) out[i] = (data[i] as number) ^ (stream[i - offset] as number);
  }
  return out;
}

function dosDateTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((Math.max(1980, at.getUTCFullYear()) - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

const AES_EXTRA = Buffer.from([0x01, 0x99, 0x07, 0x00, 0x02, 0x00, 0x41, 0x45, 0x03, 0x08, 0x00]);

/** Writes one member at a time straight to the file, so only one member is in memory. */
export class ZipWriter {
  private readonly fd: number;
  private readonly password: string | null;
  private readonly centrals: Buffer[] = [];
  private offset = 0;
  private readonly stamp: { time: number; date: number };

  constructor(path: string, password: string | null, at: Date = new Date()) {
    this.fd = openSync(path, 'wx', 0o640);
    this.password = password;
    this.stamp = dosDateTime(at);
  }

  private write(buffer: Buffer): void {
    for (let done = 0; done < buffer.length; ) done += writeSync(this.fd, buffer, done, buffer.length - done);
    this.offset += buffer.length;
  }

  add(name: string, plain: Buffer): void {
    if (plain.length >= 0xffffffff || this.offset >= 0xffffffff) throw new Error('The archive is too large for a zip file.');
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(plain, { level: 6 });
    let body: Buffer;
    let method: number;
    let crc: number;
    let flags: number;
    let extra: Buffer;
    if (this.password !== null) {
      const salt = randomBytes(16);
      const keys = pbkdf2Sync(Buffer.from(this.password, 'utf8'), salt, 1000, 66, 'sha1');
      const cipher = winzipCtr(keys.subarray(0, 32), packed);
      const auth = createHmac('sha1', keys.subarray(32, 64)).update(cipher).digest().subarray(0, 10);
      body = Buffer.concat([salt, keys.subarray(64, 66), cipher, auth]);
      method = 99;
      crc = 0; // AE-2 stores no CRC: the member is authenticated instead
      flags = 0x0801; // encrypted + UTF-8 name
      extra = AES_EXTRA;
    } else {
      body = packed;
      method = 8;
      crc = crc32(plain);
      flags = 0x0800;
      extra = Buffer.alloc(0);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(this.password !== null ? 51 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(this.stamp.time, 10);
    local.writeUInt16LE(this.stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(this.password !== null ? 51 : 20, 4);
    central.writeUInt16LE(this.password !== null ? 51 : 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(this.stamp.time, 12);
    central.writeUInt16LE(this.stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(this.offset, 42);
    this.centrals.push(Buffer.concat([central, nameBytes, extra]));
    this.write(Buffer.concat([local, nameBytes, extra]));
    this.write(body);
  }

  /** Central directory, end record, fsync, close. */
  finish(): void {
    const start = this.offset;
    const directory = Buffer.concat(this.centrals);
    this.write(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.centrals.length, 8);
    end.writeUInt16LE(this.centrals.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    fsyncSync(this.fd);
    closeSync(this.fd);
  }

  abort(): void {
    try {
      closeSync(this.fd);
    } catch {
      // already closed
    }
  }
}

/* ------------------------------------------------------------------ */
/* tar                                                                 */
/* ------------------------------------------------------------------ */

function tarHeader(name: string, size: number, mtimeS: number): Buffer {
  // ustar: up to 100 bytes of name plus up to 155 bytes of prefix, split at a "/".
  let prefix = '';
  let short = name;
  if (Buffer.byteLength(name) > 100) {
    let cut = -1;
    for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
      if (Buffer.byteLength(name.slice(0, at)) <= 155 && Buffer.byteLength(name.slice(at + 1)) <= 100) cut = at;
    }
    if (cut === -1) throw new Error(`A name in the archive is too long: ${name.slice(0, 60)}…`);
    prefix = name.slice(0, cut);
    short = name.slice(cut + 1);
  }
  const header = Buffer.alloc(512);
  header.write(short, 0, 'utf8');
  header.write(prefix, 345, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write(Math.floor(mtimeS).toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write('0', 156, 'ascii');
  header.write('ustar\0' + '00', 257, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return header;
}

function writeAll(out: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    out.once('error', onError);
    const done = (): void => {
      out.off('error', onError);
      resolve();
    };
    if (out.write(chunk)) done();
    else out.once('drain', done);
  });
}

export type TarMember = { name: string; data: Buffer } | { name: string; file: string };

/** Stream an uncompressed ustar archive into `out` with back-pressure. Does not end `out`. */
export async function writeTar(out: Writable, members: TarMember[], onBytes?: (bytes: number) => void): Promise<void> {
  const mtime = Date.now() / 1000;
  for (const member of members) {
    const size = 'data' in member ? member.data.length : statSync(member.file).size;
    await writeAll(out, tarHeader(member.name, size, mtime));
    if ('data' in member) {
      await writeAll(out, member.data);
      onBytes?.(size);
    } else {
      for await (const chunk of createReadStream(member.file, { highWaterMark: 1024 * 1024 })) {
        await writeAll(out, chunk as Buffer);
        onBytes?.((chunk as Buffer).length);
      }
    }
    const pad = (512 - (size % 512)) % 512;
    if (pad > 0) await writeAll(out, Buffer.alloc(pad));
  }
  await writeAll(out, Buffer.alloc(1024));
}

/* ------------------------------------------------------------------ */
/* csv                                                                 */
/* ------------------------------------------------------------------ */

/** One CSV cell: formula guard first, then RFC 4180 quoting. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  // A cell that a spreadsheet would run as a formula gets a leading apostrophe.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 with BOM (so Excel shows ɛ ɔ ŋ), header row, CRLF line ends. */
export function csvFile(header: string[], rows: (string | number | null)[][]): Buffer {
  const lines = [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}
