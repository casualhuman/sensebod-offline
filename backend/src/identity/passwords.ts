/*
 * Password hashing (R-4): scrypt from node:crypto (memory-hard, built in, no
 * native module), stored as a self-describing string with parameters and
 * salt so the cost can be raised later:
 *
 *   $scrypt$ln=15,r=8,p=1$<salt base64>$<hash base64>
 *
 * Hashing is asynchronous (libuv thread pool) and at most two hashes run at a
 * time, so sign-ins cannot starve the fsync of upload chunks (V-028). The
 * cost (N = 2^15, r = 8: 32 MiB per hash) is to be confirmed on the Pi
 * (PERF-1: < 1 s per hash).
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptParams {
  ln: number;
  r: number;
  p: number;
}

export const DEFAULT_PARAMS: ScryptParams = { ln: 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const MAX_CONCURRENT = 2;

let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const N = 2 ** params.ln;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r: params.r, p: params.p, maxmem: 256 * N * params.r }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): Promise<string> {
  return slot(async () => {
    const salt = randomBytes(16);
    const key = await derive(password, salt, params);
    return '$scrypt$ln=' + params.ln + ',r=' + params.r + ',p=' + params.p + '$' + salt.toString('base64') + '$' + key.toString('base64');
  });
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const match = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(stored);
  if (!match) return null;
  const params = { ln: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
  if (params.ln < 10 || params.ln > 20 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 4) return null;
  return { params, salt: Buffer.from(match[4] as string, 'base64'), key: Buffer.from(match[5] as string, 'base64') };
}

/** A hash that no password matches, used to spend the same time for unknown usernames. */
const DUMMY = '$scrypt$ln=15,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Constant-time check. A stored value in an unknown format (e.g. the override marker) never matches. */
export function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  return slot(async () => {
    const real = stored === null ? null : parse(stored);
    const parsed = real ?? parse(DUMMY);
    if (!parsed) return false;
    const key = await derive(password, parsed.salt, parsed.params);
    const equal = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
    return equal && real !== null;
  });
}

export function isPasswordHash(stored: string): boolean {
  return parse(stored) !== null;
}

/** The account's password was voided by an override code; the next step must set a new one. */
export const OVERRIDE_MARKER = '!override$';

const COMMON = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  '1234567890',
  '12345678910',
  '0123456789',
  '0987654321',
  'qwertyuiop',
  'qwerty12345',
  '1q2w3e4r5t',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'sensebod12',
  'sensebod123',
  'sensebodoffline',
  'sensebod-offline12',
  'sensebod-offline123',
  'easystem12',
  'easystem123',
  'sierraleone',
  'freetown123',
  'abcdefghij',
  'abc1234567',
  'changeme123',
]);

/** Passwords: 10 to 128 characters, not on the short common list, not the username (SYSTEM-ARCHITECTURE §9.4). */
export function passwordProblem(password: unknown, username: string): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too easy to guess. Choose another.';
  if (username && lower.indexOf(username.toLowerCase()) !== -1) return 'Do not put your username in the password.';
  return null;
}
