/*
 * Admin sessions (SYSTEM-ARCHITECTURE §3.6, §5.2, D-5.1).
 *
 * The cookie sb_admin holds a random 256-bit token; the database holds only
 * its keyed hash. A session ends at idle (2 h) or absolute (12 h) expiry, at
 * sign-out, when its account is disabled or its password changes, and at the
 * next boot (its boot id no longer matches; V-012). It is bound to the client
 * IP when session.bind_ip is on.
 *
 * requireAdmin is the guard used by every admin route; the role matrix test
 * is generated from x-auth in openapi.yaml.
 */
import { createHmac } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Ctx, Tx } from '../core/context.ts';
import type { AdminIdentity } from '../core/http.ts';
import { forbidden, unauthorised } from '../core/errors.ts';
import { randomToken } from '../core/ids.ts';
import { MINUTE, addMs, nowIso } from '../core/time.ts';
import { OVERRIDE_MARKER } from './passwords.ts';

export const SESSION_COOKIE = 'sb_admin';
const LAST_SEEN_EVERY_MS = 5 * MINUTE;
const CONFIRM_FOR_MS = 5 * MINUTE;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name && out[name] === undefined) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export function sessionKey(ctx: Ctx, token: string): string {
  return createHmac('sha256', ctx.keys.pepper).update(token).digest('hex');
}

/** No Secure flag: the bag speaks plain HTTP (ADR-004). */
export function setCookie(res: Response, name: string, value: string, options: { path: string; maxAgeS?: number }): void {
  const parts = [name + '=' + value, 'Path=' + options.path, 'HttpOnly', 'SameSite=Strict'];
  if (options.maxAgeS !== undefined) parts.push('Max-Age=' + options.maxAgeS);
  res.append('Set-Cookie', parts.join('; '));
}

export function clearCookie(res: Response, name: string, path: string): void {
  setCookie(res, name, '', { path, maxAgeS: 0 });
}

/** Insert a session row inside the caller's transaction and return the cookie token. */
export function createSession(ctx: Ctx, tx: Tx, adminId: string, ip: string, lifetime: { idleMs: number; absoluteMs: number }): string {
  const token = randomToken(32);
  const now = nowIso();
  tx.run(
    'INSERT INTO admin_session (token_sha256, admin_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, client_ip, boot_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sessionKey(ctx, token),
    adminId,
    now,
    now,
    addMs(now, lifetime.idleMs),
    addMs(now, lifetime.absoluteMs),
    ip,
    ctx.boot.bootId,
  );
  return token;
}

export function normalLifetime(ctx: Ctx): { idleMs: number; absoluteMs: number } {
  return { idleMs: ctx.config.session.idleMinutes * MINUTE, absoluteMs: ctx.config.session.absoluteMinutes * MINUTE };
}

interface SessionRow {
  token_sha256: string;
  admin_id: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  client_ip: string;
  boot_id: string;
  username: string;
  display_name: string;
  role: 'hub_manager' | 'admin';
  is_active: number;
  must_change_password: number;
  password_hash: string;
}

/** Re-authentication ("type the password again"), valid 5 minutes, kept in memory by session key. */
const confirmedUntil = new Map<string, number>();

export function markConfirmed(key: string): void {
  confirmedUntil.set(key, performance.now() + CONFIRM_FOR_MS);
}

export function forgetConfirmation(key: string): void {
  confirmedUntil.delete(key);
}

/** 403 reauth_required unless the password was typed again in the last 5 minutes. */
export function requireConfirmed(req: Request): void {
  const admin = req.sb.admin;
  const until = admin ? confirmedUntil.get(admin.sessionKey) : undefined;
  if (until === undefined || until < performance.now()) throw forbidden('reauth_required', 'Type your password again to do this.');
}

/** Look the session up. Returns null for anything that is not a live session. */
export function resolveSession(ctx: Ctx, req: Request): AdminIdentity | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  const key = sessionKey(ctx, token);
  const row = ctx.db.get<SessionRow>(
    'SELECT s.token_sha256, s.admin_id, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at, s.client_ip, s.boot_id, ' +
      'a.username, a.display_name, a.role, a.is_active, a.must_change_password, a.password_hash ' +
      'FROM admin_session s JOIN admin_account a ON a.id = s.admin_id WHERE s.token_sha256 = ?',
    key,
  );
  if (!row) return null;
  const now = nowIso();
  const expired = row.is_active !== 1 || row.boot_id !== ctx.boot.bootId || row.idle_expires_at <= now || row.absolute_expires_at <= now;
  if (expired) {
    void ctx.write((tx) => tx.run('DELETE FROM admin_session WHERE token_sha256 = ?', key)).catch(() => undefined);
    confirmedUntil.delete(key);
    return null;
  }
  // A cookie presented from another address is refused, but the session stays for its owner.
  if (ctx.config.session.bindIp && row.client_ip !== req.sb.ip) return null;
  const overrideSession = row.password_hash.startsWith(OVERRIDE_MARKER);
  // last_seen is written at most every 5 minutes per session. The 15-minute override session is never extended.
  if (!overrideSession && Date.parse(now) - Date.parse(row.last_seen_at) > LAST_SEEN_EVERY_MS) {
    const idle = addMs(now, ctx.config.session.idleMinutes * MINUTE);
    void ctx
      .write((tx) => tx.run('UPDATE admin_session SET last_seen_at = ?, idle_expires_at = min(?, absolute_expires_at) WHERE token_sha256 = ?', now, idle, key))
      .catch(() => undefined);
  }
  return {
    id: row.admin_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    sessionKey: key,
    overrideSession,
  };
}

export type Need = 'admin' | 'hub-manager';

/**
 * The guard of every admin route. `need` comes from x-auth in openapi.yaml.
 * An account that must change its password (first sign-in with a temporary
 * password, or an override session) may only read its session, sign out and
 * set the new password; such routes pass allowRestricted.
 */
export function requireAdmin(ctx: Ctx, need: Need = 'admin', options: { allowRestricted?: boolean } = {}): RequestHandler {
  return (req, _res, next) => {
    const admin = resolveSession(ctx, req);
    if (!admin) {
      next(unauthorised());
      return;
    }
    req.sb.admin = admin;
    if (admin.mustChangePassword && !options.allowRestricted) {
      next(forbidden('password_change_required', 'Choose a new password first.'));
      return;
    }
    if (need === 'hub-manager' && admin.role !== 'hub_manager') {
      next(forbidden('forbidden', 'Only a hub manager can do this.'));
      return;
    }
    next();
  };
}

export function endSessionsOf(tx: Tx, adminId: string, exceptKey: string | null = null): void {
  const rows = tx.all<{ token_sha256: string }>('SELECT token_sha256 FROM admin_session WHERE admin_id = ?', adminId);
  for (const row of rows) {
    if (row.token_sha256 === exceptKey) continue;
    tx.run('DELETE FROM admin_session WHERE token_sha256 = ?', row.token_sha256);
    confirmedUntil.delete(row.token_sha256);
  }
}
