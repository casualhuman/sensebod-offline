/*
 * identity routes: sign-in, session, re-authentication, own password, and
 * account management by hub managers (SYSTEM-ARCHITECTURE §5.2, §9.4).
 * There is no local password reset by another admin (OWNER-3): a forgotten
 * password is recovered with an override code (override.ts) or by a
 * technician at the bag.
 */
import { Router } from 'express';
import type { Ctx, Tx } from '../core/context.ts';
import { ApiError, asObject, conflict, forbidden, invalid, notFound, rateLimited } from '../core/errors.ts';
import { pathParam, sendJson, sendNoContent, type AdminIdentity } from '../core/http.ts';
import { actorScope, beginIdempotent } from '../core/idempotency.ts';
import { newId } from '../core/ids.ts';
import { MINUTE, addMs, nowIso } from '../core/time.ts';
import { OVERRIDE_MARKER, hashPassword, passwordProblem, verifyPassword } from './passwords.ts';
import {
  SESSION_COOKIE,
  clearCookie,
  createSession,
  endSessionsOf,
  forgetConfirmation,
  markConfirmed,
  normalLifetime,
  requireAdmin,
  requireConfirmed,
  setCookie,
} from './sessions.ts';

const BAD_CREDENTIALS = 'That username or password is not right. Try again.';
const LOCK_AFTER = 5;
const MAX_LOCK_MS = 15 * MINUTE;

interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  role: 'hub_manager' | 'admin';
  password_hash: string;
  is_active: number;
  must_change_password: number;
  failed_count: number;
  locked_until: string | null;
  created_at: string;
}

function sessionBody(admin: Pick<AdminIdentity, 'username' | 'displayName' | 'role' | 'mustChangePassword'>) {
  return { username: admin.username, displayName: admin.displayName, role: admin.role, mustChangePassword: admin.mustChangePassword };
}

function accountBody(row: AccountRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

/** Lock length after `failed` wrong passwords: 1 minute at 5, doubling, 15 minutes at most. */
export function lockMs(failed: number): number {
  if (failed < LOCK_AFTER) return 0;
  return Math.min(MAX_LOCK_MS, MINUTE * 2 ** Math.min(10, failed - LOCK_AFTER));
}

/** Seconds a locked account still has to wait. A lock further away than the maximum (clock moved back) is cut to it. */
function lockLeftS(row: AccountRow): number {
  if (!row.locked_until) return 0;
  const left = Date.parse(row.locked_until) - Date.now();
  if (left <= 0) return 0;
  return Math.ceil(Math.min(left, MAX_LOCK_MS) / 1000);
}

function recordFailure(tx: Tx, row: AccountRow, ip: string, action: string): void {
  // Counted from what is stored now, not from what was read before the hash ran: parallel wrong
  // passwords each add one (and each attempt for an account also waits its turn, see `oneAtATime`).
  const failed = Number(tx.value('SELECT failed_count FROM admin_account WHERE id = ?', row.id) ?? row.failed_count) + 1;
  const lock = lockMs(failed);
  tx.run('UPDATE admin_account SET failed_count = ?, locked_until = ? WHERE id = ?', failed, lock > 0 ? addMs(nowIso(), lock) : null, row.id);
  tx.audit({ actorId: row.id, actorName: row.username, action, outcome: 'refused', detail: { failedCount: failed, locked: lock > 0 }, clientIp: ip });
}

/**
 * Password checks for one account run one after the other, so the sequence "is it locked? → hash →
 * count the failure" cannot be raced by parallel requests. Waiters are bounded; beyond that, 429.
 */
const queues = new Map<string, { tail: Promise<unknown>; waiting: number }>();
const MAX_WAITING = 8;

async function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const entry = queues.get(key) ?? { tail: Promise.resolve(), waiting: 0 };
  if (entry.waiting >= MAX_WAITING) throw rateLimited(5);
  queues.set(key, entry);
  entry.waiting += 1;
  const turn = entry.tail.then(work);
  entry.tail = turn.catch(() => undefined);
  try {
    return await turn;
  } finally {
    entry.waiting -= 1;
    if (entry.waiting === 0) queues.delete(key);
  }
}

function findAccount(ctx: Ctx, username: string): AccountRow | undefined {
  return ctx.db.get<AccountRow>('SELECT * FROM admin_account WHERE username = ?', username);
}

/** Check the signed-in admin's own password, with the same lockout as sign-in. */
function checkOwnPassword(ctx: Ctx, admin: AdminIdentity, password: unknown, ip: string, action: string): Promise<void> {
  return oneAtATime(admin.id, () => checkOwnPasswordNow(ctx, admin, password, ip, action));
}

async function checkOwnPasswordNow(ctx: Ctx, admin: AdminIdentity, password: unknown, ip: string, action: string): Promise<void> {
  const row = ctx.db.get<AccountRow>('SELECT * FROM admin_account WHERE id = ?', admin.id);
  if (!row) throw new ApiError(401, 'unauthorised', 'Sign in to use the admin.');
  const wait = lockLeftS(row);
  if (wait > 0) throw rateLimited(wait, 'Too many wrong passwords. Wait a little, then try again.');
  const ok = typeof password === 'string' && password.length <= 128 && (await verifyPassword(password, row.password_hash));
  if (!ok) {
    await ctx.write((tx) => recordFailure(tx, row, ip, action));
    throw new ApiError(401, 'bad_credentials', 'That password is not right. Try again.');
  }
  if (row.failed_count > 0) await ctx.write((tx) => tx.run('UPDATE admin_account SET failed_count = 0, locked_until = NULL WHERE id = ?', row.id));
}

export function identityRoutes(ctx: Ctx): Router {
  const router = Router();

  /* ---- sign in ---- */
  router.post('/admin/session', async (req, res) => {
    const input = asObject(req.sb.body);
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!username || username.length > 32 || !password || password.length > 128) {
      throw invalid('Type your username and password.', { ...(username ? {} : { username: 'Type your username.' }), ...(password ? {} : { password: 'Type your password.' }) });
    }
    // Keyed by the account when it exists, else by the name typed, so unknown names queue the same way.
    const known = findAccount(ctx, username);
    const { row, token } = await oneAtATime(known ? known.id : `name:${username.toLowerCase()}`, async () => {
      const row = findAccount(ctx, username);
      if (row) {
        const wait = lockLeftS(row);
        if (wait > 0) throw rateLimited(wait, 'Too many wrong passwords. Wait a little, then try again.');
      }
      // An unknown or disabled account costs the same time as a wrong password and gets the same words.
      const ok = await verifyPassword(password, row && row.is_active === 1 ? row.password_hash : null);
      if (!row || !ok) {
        if (row && row.is_active === 1) await ctx.write((tx) => recordFailure(tx, row, req.sb.ip, 'admin.signin'));
        else await ctx.write((tx) => tx.audit({ action: 'admin.signin', outcome: 'refused', detail: { reason: 'unknown_or_disabled' }, clientIp: req.sb.ip }));
        throw new ApiError(401, 'bad_credentials', BAD_CREDENTIALS);
      }
      const token = await ctx.write((tx) => {
        // Disabled while the hash was running? Then there is no session.
        if (!tx.get('SELECT 1 FROM admin_account WHERE id = ? AND is_active = 1', row.id)) throw new ApiError(401, 'bad_credentials', BAD_CREDENTIALS);
        tx.run('UPDATE admin_account SET failed_count = 0, locked_until = NULL WHERE id = ?', row.id);
        tx.audit({ actorId: row.id, actorName: row.username, action: 'admin.signin', clientIp: req.sb.ip });
        return createSession(ctx, tx, row.id, req.sb.ip, normalLifetime(ctx));
      });
      return { row, token };
    });
    setCookie(res, SESSION_COOKIE, token, { path: '/' });
    sendJson(res, 200, sessionBody({ username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password === 1 }));
  });

  router.get('/admin/session', requireAdmin(ctx, 'admin', { allowRestricted: true }), (req, res) => {
    sendJson(res, 200, sessionBody(req.sb.admin as AdminIdentity));
  });

  router.delete('/admin/session', requireAdmin(ctx, 'admin', { allowRestricted: true }), async (req, res) => {
    const admin = req.sb.admin as AdminIdentity;
    await ctx.write((tx) => {
      tx.run('DELETE FROM admin_session WHERE token_sha256 = ?', admin.sessionKey);
      tx.audit({ actorId: admin.id, actorName: admin.username, action: 'admin.signout', clientIp: req.sb.ip });
    });
    forgetConfirmation(admin.sessionKey);
    clearCookie(res, SESSION_COOKIE, '/');
    sendNoContent(res);
  });

  /* ---- type the password again (valid 5 minutes) ---- */
  router.post('/admin/session/confirm', requireAdmin(ctx), async (req, res) => {
    const admin = req.sb.admin as AdminIdentity;
    await checkOwnPassword(ctx, admin, asObject(req.sb.body).password, req.sb.ip, 'admin.confirm');
    markConfirmed(admin.sessionKey);
    sendNoContent(res);
  });

  /* ---- change my password ---- */
  router.post('/admin/session/password', requireAdmin(ctx, 'admin', { allowRestricted: true }), async (req, res) => {
    const admin = req.sb.admin as AdminIdentity;
    const input = asObject(req.sb.body);
    // currentPassword is needed, except in the restricted session an override code gave (its old password is void).
    if (!admin.overrideSession) await checkOwnPassword(ctx, admin, input.currentPassword, req.sb.ip, 'admin.password');
    const problem = passwordProblem(input.newPassword, admin.username);
    if (problem) throw invalid(problem, { newPassword: problem });
    if (!admin.overrideSession && input.newPassword === input.currentPassword) throw invalid('Choose a password you have not used here.', { newPassword: 'Choose a different password.' });
    const hash = await hashPassword(input.newPassword as string);
    const lifetime = normalLifetime(ctx);
    await ctx.write((tx) => {
      const now = nowIso();
      const changed = tx.run(
        'UPDATE admin_account SET password_hash = ?, must_change_password = 0, failed_count = 0, locked_until = NULL, password_changed_at = ?, seq = ? WHERE id = ? AND is_active = 1',
        hash,
        now,
        tx.seq(),
        admin.id,
      );
      // The session may have ended while the password was being hashed (signed out, disabled, expired).
      if (changed !== 1 || !tx.get('SELECT 1 FROM admin_session WHERE token_sha256 = ? AND admin_id = ?', admin.sessionKey, admin.id)) {
        throw new ApiError(401, 'unauthorised', 'Sign in to use the admin.');
      }
      // Every other session of this account ends; this one becomes an ordinary session.
      endSessionsOf(tx, admin.id, admin.sessionKey);
      tx.run(
        'UPDATE admin_session SET last_seen_at = ?, idle_expires_at = ?, absolute_expires_at = ? WHERE token_sha256 = ?',
        now,
        addMs(now, lifetime.idleMs),
        addMs(now, lifetime.absoluteMs),
        admin.sessionKey,
      );
      tx.audit({ actorId: admin.id, actorName: admin.username, action: 'admin.password.change', detail: { afterOverride: admin.overrideSession }, clientIp: req.sb.ip });
    });
    sendNoContent(res);
  });

  /* ---- accounts (hub manager) ---- */
  router.get('/admin/accounts', requireAdmin(ctx, 'hub-manager'), (_req, res) => {
    sendJson(res, 200, ctx.db.all<AccountRow>('SELECT * FROM admin_account ORDER BY created_at, id').map(accountBody));
  });

  router.post('/admin/accounts', requireAdmin(ctx, 'hub-manager'), async (req, res) => {
    const admin = req.sb.admin as AdminIdentity;
    requireConfirmed(req);
    const input = asObject(req.sb.body);
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const fields: Record<string, string> = {};
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) fields.username = 'Use 3 to 32 letters, numbers, dots or dashes.';
    if (displayName.length < 1 || displayName.length > 60) fields.displayName = 'Type a name of up to 60 letters.';
    if (input.role !== 'hub_manager' && input.role !== 'admin') fields.role = 'Choose hub manager or admin.';
    const problem = passwordProblem(input.temporaryPassword, username);
    if (problem) fields.temporaryPassword = problem;
    if (Object.keys(fields).length > 0) throw invalid('Some details are missing or not right.', fields);

    // The password never enters the idempotency fingerprint or the stored answer.
    const slot = await beginIdempotent(ctx, req, { scope: actorScope(req), required: false, fingerprint: JSON.stringify([username.toLowerCase(), displayName, input.role]) });
    if (slot.replay) {
      sendJson(res, slot.replay.status, slot.replay.body);
      return;
    }
    try {
      const hash = await hashPassword(input.temporaryPassword as string);
      const body = await ctx.write((tx) => {
        if (tx.get('SELECT 1 FROM admin_account WHERE username = ?', username)) throw conflict('conflict', 'That username is already used on this bag.');
        const count = Number(tx.value('SELECT count(*) FROM admin_account WHERE is_active = 1') ?? 0);
        if (count >= ctx.config.limits.maxAdminAccounts) throw conflict('conflict', `This bag already has ${ctx.config.limits.maxAdminAccounts} admins. Switch one off first.`);
        const now = nowIso();
        const id = newId('ad');
        tx.run(
          'INSERT INTO admin_account (id, username, display_name, role, password_hash, is_active, must_change_password, failed_count, created_at, password_changed_at, seq) VALUES (?, ?, ?, ?, ?, 1, 1, 0, ?, ?, ?)',
          id,
          username,
          displayName,
          input.role as string,
          hash,
          now,
          now,
          tx.seq(),
        );
        tx.audit({ actorId: admin.id, actorName: admin.username, action: 'admin.account.create', targetType: 'admin_account', targetId: id, detail: { role: input.role }, clientIp: req.sb.ip });
        const created = accountBody(tx.get<AccountRow>('SELECT * FROM admin_account WHERE id = ?', id) as AccountRow);
        slot.complete(tx, { status: 201, body: created });
        return created;
      });
      sendJson(res, 201, body);
    } catch (error) {
      await slot.abort();
      throw error;
    }
  });

  router.patch('/admin/accounts/:accountId', requireAdmin(ctx, 'hub-manager'), async (req, res) => {
    const admin = req.sb.admin as AdminIdentity;
    requireConfirmed(req);
    const input = asObject(req.sb.body);
    const id = pathParam(req, 'accountId');
    const fields: Record<string, string> = {};
    if ('password' in input || 'temporaryPassword' in input) throw forbidden('forbidden', 'Passwords cannot be reset here. Use an override code from EasySTEM.');
    if (input.displayName !== undefined && (typeof input.displayName !== 'string' || input.displayName.trim().length < 1 || input.displayName.trim().length > 60)) {
      fields.displayName = 'Type a name of up to 60 letters.';
    }
    if (input.role !== undefined && input.role !== 'hub_manager' && input.role !== 'admin') fields.role = 'Choose hub manager or admin.';
    if (input.isActive !== undefined && typeof input.isActive !== 'boolean') fields.isActive = 'Choose on or off.';
    if (Object.keys(fields).length > 0) throw invalid('Some details are not right.', fields);

    const body = await ctx.write((tx) => {
      const row = tx.get<AccountRow>('SELECT * FROM admin_account WHERE id = ?', id);
      if (!row) throw notFound('This account');
      const role = (input.role as AccountRow['role'] | undefined) ?? row.role;
      const active = input.isActive === undefined ? row.is_active === 1 : input.isActive === true;
      // The bag must always keep one active hub manager.
      if (row.role === 'hub_manager' && row.is_active === 1 && (role !== 'hub_manager' || !active)) {
        const others = Number(tx.value("SELECT count(*) FROM admin_account WHERE role = 'hub_manager' AND is_active = 1 AND id <> ?", row.id) ?? 0);
        if (others === 0) throw conflict('conflict', 'This is the only hub manager. Make another hub manager first.');
      }
      if (active && row.is_active !== 1) {
        const count = Number(tx.value('SELECT count(*) FROM admin_account WHERE is_active = 1') ?? 0);
        if (count >= ctx.config.limits.maxAdminAccounts) throw conflict('conflict', `This bag already has ${ctx.config.limits.maxAdminAccounts} admins. Switch one off first.`);
      }
      tx.run(
        'UPDATE admin_account SET display_name = ?, role = ?, is_active = ?, seq = ? WHERE id = ?',
        typeof input.displayName === 'string' ? input.displayName.trim() : row.display_name,
        role,
        active ? 1 : 0,
        tx.seq(),
        row.id,
      );
      // Disabling, or lowering the role, takes effect at once.
      if (!active || role !== row.role) endSessionsOf(tx, row.id, null);
      tx.audit({
        actorId: admin.id,
        actorName: admin.username,
        action: 'admin.account.update',
        targetType: 'admin_account',
        targetId: row.id,
        detail: { role, isActive: active, roleChanged: role !== row.role, activeChanged: active !== (row.is_active === 1) },
        clientIp: req.sb.ip,
      });
      return accountBody(tx.get<AccountRow>('SELECT * FROM admin_account WHERE id = ?', row.id) as AccountRow);
    });
    sendJson(res, 200, body);
  });

  return router;
}

/** Used by the CLI and by provisioning: create an account directly. */
export function insertAccount(
  tx: Tx,
  input: { username: string; displayName: string; role: 'hub_manager' | 'admin'; passwordHash: string; mustChangePassword: boolean },
): string {
  const now = nowIso();
  const id = newId('ad');
  tx.run(
    'INSERT INTO admin_account (id, username, display_name, role, password_hash, is_active, must_change_password, failed_count, created_at, password_changed_at, seq) VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)',
    id,
    input.username,
    input.displayName,
    input.role,
    input.passwordHash,
    input.mustChangePassword ? 1 : 0,
    now,
    now,
    tx.seq(),
  );
  return id;
}

export { OVERRIDE_MARKER };
