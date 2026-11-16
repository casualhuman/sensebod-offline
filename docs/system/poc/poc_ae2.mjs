// Throwaway PoC for V-027 (revision 3): is a WinZip AES-256 (AE-2) learner-data zip cheap to produce and
// interoperable? Mac only (Node v23, macOS bsdtar/libarchive 3.8.2 with CommonCrypto). Not a Pi, not 7-Zip.
//
// 1. A minimal AE-2 writer and reader using ONLY node:crypto + node:zlib (no native module, no npm package):
//    PBKDF2-HMAC-SHA1 (1000 iterations, 16-byte salt) -> 32-byte AES key, 32-byte HMAC key, 2-byte verifier;
//    AES-256 in CTR mode with the WinZip little-endian counter starting at 1; HMAC-SHA1 over the ciphertext,
//    first 10 bytes stored; CRC field 0 (AE-2); extra field 0x9901 (vendor version 2, "AE", strength 3, method 8).
// 2. Cross-check against an independent implementation: libarchive (bsdtar) writes an AE-2 zip -> our reader
//    opens it; our writer writes an AE-2 zip -> libarchive extracts it. Wrong password must fail both ways.
// Note: bsdtar takes the passphrase on argv (--passphrase); that is acceptable for this throwaway test only and is
// exactly what R-8 forbids in production (argv is visible in /proc/<pid>/cmdline).
// Run: node poc_ae2.mjs   (needs /usr/bin/bsdtar; creates and removes work_ae2/ next to this file)
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = join(dirname(fileURLToPath(import.meta.url)), 'work_ae2');

function keys(password, salt) {
  const k = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 1000, 66, 'sha1');
  return { enc: k.subarray(0, 32), mac: k.subarray(32, 64), pwv: k.subarray(64, 66) };
}
function ctrLE(key, data) {                       // WinZip AES: CTR with a little-endian 128-bit counter from 1
  const out = Buffer.alloc(data.length);
  const ecb = crypto.createCipheriv('aes-256-ecb', key, null); ecb.setAutoPadding(false);
  const ctr = Buffer.alloc(16);
  for (let off = 0, n = 1; off < data.length; off += 16, n++) {
    ctr.fill(0); let x = n; for (let i = 0; i < 8 && x > 0; i++) { ctr[i] = x & 0xff; x = Math.floor(x / 256); }
    const ks = ecb.update(ctr);
    for (let i = 0; i < 16 && off + i < data.length; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}
const aesExtra = () => Buffer.from([0x01, 0x99, 0x07, 0x00, 0x02, 0x00, 0x41, 0x45, 0x03, 0x08, 0x00]);

function writeAE2(entries, password) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of entries) {
    const plain = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(plain);
    const salt = crypto.randomBytes(16), k = keys(password, salt);
    const cipher = ctrLE(k.enc, comp);
    const auth = crypto.createHmac('sha1', k.mac).update(cipher).digest().subarray(0, 10);
    const body = Buffer.concat([salt, k.pwv, cipher, auth]);
    const nameB = Buffer.from(name, 'utf8'), extra = aesExtra();
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(51, 4); lh.writeUInt16LE(0x0801, 6); lh.writeUInt16LE(99, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x5b6d, 12); lh.writeUInt32LE(0, 14);           // CRC 0 for AE-2
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(plain.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(extra.length, 28);
    const local = Buffer.concat([lh, nameB, extra, body]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(51, 4); ch.writeUInt16LE(51, 6); ch.writeUInt16LE(0x0801, 8);
    ch.writeUInt16LE(99, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x5b6d, 14); ch.writeUInt32LE(0, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(plain.length, 24); ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt16LE(extra.length, 30); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameB, extra])); locals.push(local); offset += local.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function readAE2(buf, password) {                 // reads local headers (sizes taken from the central directory)
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), xlen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42), name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const extra = buf.subarray(p + 46 + nlen, p + 46 + nlen + elen);
    if (method !== 99) throw new Error(`${name}: not AES`);
    let ae = -1;                                    // walk the extra fields by header id (0x9901 = WinZip AES)
    for (let q = 0; q + 4 <= extra.length; q += 4 + extra.readUInt16LE(q + 2)) if (extra.readUInt16LE(q) === 0x9901) { ae = q; break; }
    if (ae < 0) throw new Error(`${name}: no AES extra field`);
    const version = extra.readUInt16LE(ae + 4), strength = extra[ae + 8], realMethod = extra.readUInt16LE(ae + 9);
    const lnl = buf.readUInt16LE(lho + 26), lel = buf.readUInt16LE(lho + 28), d = lho + 30 + lnl + lel;
    const body = buf.subarray(d, d + csize);
    const salt = body.subarray(0, 16), pwv = body.subarray(16, 18), cipher = body.subarray(18, body.length - 10);
    const k = keys(password, salt);
    if (!k.pwv.equals(pwv)) throw new Error(`${name}: wrong password (verifier)`);
    const mac = crypto.createHmac('sha1', k.mac).update(cipher).digest().subarray(0, 10);
    if (!mac.equals(body.subarray(body.length - 10))) throw new Error(`${name}: authentication failed`);
    const comp = ctrLE(k.enc, cipher);
    out[name] = { text: (realMethod === 8 ? zlib.inflateRawSync(comp) : comp).toString('utf8'), version: `AE-${version}`, strength };
    p += 46 + nlen + elen + xlen;
  }
  return out;
}

rmSync(W, { recursive: true, force: true }); mkdirSync(W);
const csv = '﻿learner_code,role\r\nL-7F3KQ2,learner\r\nL-Q2ZT9A,teacher\r\n';
const PW = 'river-mango-seven-chalk-42';
const results = [];
// (a) libarchive writes, our node:crypto reader opens
writeFileSync(join(W, 'learners.csv'), csv);
execFileSync('/usr/bin/bsdtar', ['-c', '--format', 'zip', '--options', 'zip:encryption=aes256', '--passphrase', PW,
  '-f', join(W, 'by-libarchive.zip'), '-C', W, 'learners.csv']);
const a = readAE2(readFileSync(join(W, 'by-libarchive.zip')), PW)['learners.csv'];
results.push(`a) libarchive-written zip opened by the node:crypto reader: ${a.version}, strength ${a.strength} (3 = AES-256), content equal=${a.text === csv}`);
let wrongA = 'opened (BAD)'; try { readAE2(readFileSync(join(W, 'by-libarchive.zip')), 'wrong'); } catch (e) { wrongA = `refused (${e.message})`; }
results.push(`   wrong password: ${wrongA}`);
// (b) our node:crypto writer, libarchive extracts
const big = 'learner_code,role\r\n' + Array.from({ length: 5000 }, (_, i) => `L-${i.toString(36).padStart(6, '0')},learner\r\n`).join('');
writeFileSync(join(W, 'by-node.zip'), writeAE2([['learners.csv', csv], ['progress.csv', big]], PW));
mkdirSync(join(W, 'x'));
execFileSync('/usr/bin/bsdtar', ['-x', '--passphrase', PW, '-f', join(W, 'by-node.zip'), '-C', join(W, 'x')]);
const eq = readFileSync(join(W, 'x', 'learners.csv'), 'utf8') === csv && readFileSync(join(W, 'x', 'progress.csv'), 'utf8') === big;
results.push(`b) node:crypto-written AE-2 zip (2 members, ${big.length} B progress.csv) extracted by libarchive: content equal=${eq}`);
let wrongB = 'extracted (BAD)';
try { execFileSync('/usr/bin/bsdtar', ['-x', '--passphrase', 'wrong', '-f', join(W, 'by-node.zip'), '-C', join(W, 'x')], { stdio: 'pipe' }); }
catch { wrongB = 'refused by libarchive'; }
results.push(`   wrong password: ${wrongB}`);
// (c) tamper: flip one ciphertext byte -> authentication must fail
const t = readFileSync(join(W, 'by-node.zip')); t[30 + 'learners.csv'.length + 11 + 20] ^= 1;
let tam = 'opened (BAD)'; try { readAE2(t, PW); } catch (e) { tam = `refused (${e.message})`; }
results.push(`c) one flipped ciphertext byte: ${tam}`);
console.log(results.join('\n'));
rmSync(W, { recursive: true, force: true });
