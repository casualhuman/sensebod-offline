/* Ids (ADR-016): `<prefix>-<26 lowercase RFC 4648 base32 characters>` holding 128 random bits. */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type IdPrefix = 'lr' | 'ls' | 'se' | 'up' | 'ex' | 'jb' | 'pi' | 'ad' | 'tp' | 'gr' | 'nt' | 'cj';

/** 128 random bits as 26 base32 characters (130 bits of space, top 2 bits zero). */
export function random128(): string {
  let bits = BigInt('0x' + randomBytes(16).toString('hex'));
  let out = '';
  for (let i = 0; i < 26; i += 1) {
    out = B32[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}-${random128()}`;
}

export const LEARNER_ID = /^lr-[a-z2-7]{26}$/;
export const LEARNER_ID_ANYWHERE = /lr-[a-z2-7]{26}/g;

/** The first `count` Crockford base32 characters of `data` (5 bits each, most significant first). */
export function crockford(data: Buffer, count: number): string {
  let bits = BigInt('0x' + data.toString('hex'));
  const total = BigInt(data.length * 8);
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const shift = total - BigInt(5 * (i + 1));
    out += CROCKFORD[Number((bits >> shift) & 31n)];
  }
  bits = 0n;
  return out;
}

export function crockfordIndex(char: string): number {
  return CROCKFORD.indexOf(char);
}

export function crockfordChar(value: number): string {
  return CROCKFORD[value] ?? '0';
}

/** Tolerant reading of a spoken code: case, dashes, spaces, I/L→1, O→0. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}
