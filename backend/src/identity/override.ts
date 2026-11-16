/*
 * Offline override code (ADR-017, SYSTEM-ARCHITECTURE §9.9): challenge-response,
 * no clock needed.
 *
 *   request code  = key version (1) + bag tag (4) + 40-bit nonce (8), Crockford base32
 *   override code = first 10 Crockford characters (50 bits) of
 *                   HMAC-SHA256(K_bag, "sensebod-offline-override/1|" + bag_id + "|" + v + "|" + nonce + "|" + lower(username))
 *
 * A request is bound to the browser that made it (cookie sb_ovr; only the
 * secret's hash is stored), dies at the first of 72 h of bag uptime, 20
 * boots, 72 h of trusted wall clock, one use, 5 wrong codes or a replaced
 * database. Every wrong attempt is committed before the answer (V-034).
 * There is no bag-wide failure pause; network creation has a ceiling of
 * 2,000 per 24 h of uptime and the USB-presence path cannot be blocked from
 * the Wi-Fi (V-030, V-038).
 *
 * The online path (send-online) needs EasySTEM's reset service, which is
 * phase 2 and not built: the endpoint answers 503 offline, and the person
 * reads the code to EasySTEM instead.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Router, type Request } from 'express';
import { bootUptimeS, clockIsTrusted, type Ctx, type Tx } from '../core/context.ts';
import { ApiError, asObject, forbidden, invalid, notFound, rateLimited } from '../core/errors.ts';
import { pathParam, sendJson, sendNoContent, type AdminIdentity } from '../core/http.ts';
import { crockford, crockfordChar, newId, normaliseCode, random128, randomToken, safeEqual, sha256Hex } from '../core/ids.ts';
import { HOUR, MINUTE, nowIso } from '../core/time.ts';
import { OVERRIDE_MARKER } from './passwords.ts';
import { SESSION_COOKIE, clearCookie, createSession, endSessionsOf, parseCookies, requireAdmin, setCookie } from './sessions.ts';

const OVERRIDE_PATH = '/api/v1/admin/override';
const REQUEST_COOKIE = 'sb_ovr';
const PRESENCE_COOKIE = 'sb_presence';
const LIFE_UPTIME_S = 72 * 3600;
const LIFE_WALL_MS = 72 * HOUR;
const MAX_BOOTS = 20;
const MAX_ATTEMPTS = 5;
const NETWORK_CEILING = 2000;
const CEILING_WINDOW_S = 24 * 3600;
const PRESENCE_LIVE_S = 120;
/** The token row is kept a little longer than it is live, so the page's last call after the insertion still finds it. */
const PRESENCE_KEEP_S = 150;
const RESTRICTED_SESSION_MS = 15 * MINUTE;
/** V-038: stick insertions honoured for presence per 24 h of uptime. */
const MAX_HONOURED_INSERTIONS = 20;

interface RequestRow {
  id: string;
  username: string;
  nonce: string;
  key_version: number;
  epoch: number;
  created_boot_seq: number;
  secret_sha256: string;
  presence: number;
  created_uptime_s: number;
  created_wall_at: string;
  created_clock_trust: string;
  attempts: number;
  state: string;
  received_code: string | null;
}

/** At most `limit` events per `windowMs` for one key (an IP). Memory is bounded by pruning. */
class Window {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  /** Seconds to wait, or 0 when the event is allowed (and counted). */
  take(key: string): number {
    const now = performance.now();
    const list = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return Math.ceil((this.windowMs - (now - (list[0] as number))) / 1000);
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 2000) {
      for (const [k, v] of this.hits) if (v.every((at) => now - at >= this.windowMs)) this.hits.delete(k);
    }
    return 0;
  }
}

export function bagTag(bagId: string): string {
  return crockford(Buffer.from(sha256Hex(bagId), 'hex'), 4);
}

/** The code EasySTEM's tool prints for this request. Shared with the office tool's reference logic (poc_override.py). */
export function overrideCode(key: Buffer, bagId: string, version: number, nonce: string, username: string): string {
  const mac = createHmac('sha256', key).update(`sensebod-offline-override/1|${bagId}|${version}|${nonce}|${username.toLowerCase()}`).digest();
  return crockford(mac, 10);
}

function requestCode(version: number, bagId: string, nonce: string): string {
  return `${crockfordChar(version)}-${bagTag(bagId)}-${nonce.slice(0, 4)}-${nonce.slice(4)}`;
}

/** Why a request can no longer be used, or null while it is alive. */
function deathOf(ctx: Ctx, row: RequestRow, epoch: number): 'expired' | 'void' | null {
  if (row.epoch !== epoch) return 'void';
  if (ctx.uptimeTotalS() - row.created_uptime_s >= LIFE_UPTIME_S) return 'expired';
  if (ctx.boot.bootSeq - row.created_boot_seq >= MAX_BOOTS) return 'expired';
  // Wall clock counts only when it was trusted at both ends; a hand-set date never is (V-039).
  if (clockIsTrusted(row.created_clock_trust as never) && clockIsTrusted(ctx.clockTrust()) && Date.now() - Date.parse(row.created_wall_at) >= LIFE_WALL_MS) return 'expired';
  return null;
}

function body(ctx: Ctx, row: RequestRow, state: string) {
  const bagId = ctx.meta('bag_id') ?? '';
  return {
    requestId: row.id,
    requestCode: requestCode(row.key_version, bagId, row.nonce),
    bagName: ctx.bagName(),
    state,
    attemptsLeft: state === 'open' || state === 'code-received' || state === 'waiting-for-easystem' ? Math.max(0, MAX_ATTEMPTS - row.attempts) : 0,
    expiresHint: 'Valid for about 3 days while the bag is switched on',
  };
}

const ALIVE = ['open', 'waiting-for-easystem', 'code-received', 'send-failed', 'declined'];

/** Load a request for the browser that owns it; settle its state if it died meanwhile. */
function ownedRequest(ctx: Ctx, tx: Tx, req: Request, requestId: string): { row: RequestRow; state: string } {
  const row = tx.get<RequestRow>('SELECT * FROM override_request WHERE id = ?', requestId);
  const secret = parseCookies(req.headers.cookie)[REQUEST_COOKIE] ?? '';
  // The same answer whether the request does not exist or belongs to another browser.
  if (!row || !secret || !safeEqual(sha256Hex(secret), row.secret_sha256)) throw forbidden('request_not_yours', 'This code request was made on another phone. Ask for a new code here.');
  let state = row.state;
  if (ALIVE.indexOf(state) !== -1) {
    const death = deathOf(ctx, row, Number(tx.value("SELECT value FROM bag_meta WHERE key = 'epoch'") ?? 0));
    if (death) {
      tx.run('UPDATE override_request SET state = ? WHERE id = ?', death, row.id);
      state = death;
    }
  }
  return { row, state };
}

interface UsbJson {
  lastAddAtBootS?: unknown;
}

/** Seconds since boot of the last USB block-device add event, written by the root helper sensebod-offline-usb@ (V-030). */
function lastInsertionBootS(ctx: Ctx): number | null {
  try {
    const raw = JSON.parse(readFileSync(ctx.paths.usbJson, 'utf8')) as UsbJson;
    return typeof raw.lastAddAtBootS === 'number' && raw.lastAddAtBootS >= 0 && raw.lastAddAtBootS <= bootUptimeS() ? raw.lastAddAtBootS : null;
  } catch {
    return null;
  }
}

export function overrideRoutes(ctx: Ctx): Router {
  const router = Router();
  const createPerIp = new Window(3, HOUR);
  const presencePerIp = new Window(3, HOUR);
  /** Insertion times (total uptime) already honoured, for the per-window cap (V-038). */
  let honoured: number[] = [];

  /** True when this browser holds a presence token that was live when a stick was plugged in. Uses the token up. */
  function takePresence(tx: Tx, req: Request): boolean {
    const token = parseCookies(req.headers.cookie)[PRESENCE_COOKIE];
    if (!token) return false;
    const hash = sha256Hex(token);
    const row = tx.get<{ created_uptime_s: number }>('SELECT created_uptime_s FROM override_presence WHERE token_sha256 = ?', hash);
    if (!row) return false;
    const addedAtBootS = lastInsertionBootS(ctx);
    if (addedAtBootS === null) return false;
    const insertedAt = ctx.boot.uptimeBaseS + addedAtBootS;
    if (insertedAt < row.created_uptime_s || insertedAt > row.created_uptime_s + PRESENCE_LIVE_S) return false;
    const now = ctx.uptimeTotalS();
    honoured = honoured.filter((at) => now - at < CEILING_WINDOW_S);
    if (honoured.indexOf(insertedAt) === -1) {
      if (honoured.length >= MAX_HONOURED_INSERTIONS) return false;
      honoured.push(insertedAt);
    }
    tx.run('UPDATE override_presence SET insertion_at_uptime_s = ? WHERE token_sha256 = ?', insertedAt, hash);
    tx.run('DELETE FROM override_presence WHERE token_sha256 = ?', hash);
    return true;
  }

  /* ---- "I am at the bag" ---- */
  router.post('/admin/override/presence', async (req, res) => {
    const wait = presencePerIp.take(req.sb.ip);
    if (wait > 0) throw rateLimited(wait);
    const token = randomToken(32);
    await ctx.write((tx) => {
      const now = ctx.uptimeTotalS();
      tx.run('DELETE FROM override_presence WHERE created_uptime_s < ? OR created_uptime_s > ?', now - PRESENCE_KEEP_S, now);
      tx.run('INSERT INTO override_presence (token_sha256, created_uptime_s, client_ip) VALUES (?, ?, ?)', sha256Hex(token), now, req.sb.ip);
      tx.audit({ action: 'admin.override.presence', clientIp: req.sb.ip });
    });
    setCookie(res, PRESENCE_COOKIE, token, { path: OVERRIDE_PATH, maxAgeS: PRESENCE_KEEP_S });
    sendNoContent(res);
  });

  /* ---- ask for a request code ---- */
  router.post('/admin/override/requests', async (req, res) => {
    const input = asObject(req.sb.body);
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    if (username.length < 3 || username.length > 32) throw invalid('Type your username.', { username: 'Type your username (3 to 32 characters).' });
    const wantsPresence = input.presence === true;
    const secret = randomToken(32);

    const created = await ctx.write((tx) => {
      const now = ctx.uptimeTotalS();
      const presence = wantsPresence && takePresence(tx, req);
      if (!presence) {
        if (wantsPresence) throw new ApiError(409, 'presence_not_seen', 'Plug any USB stick into the bag, then try again.');
        const recent = Number(tx.value('SELECT count(*) FROM override_request WHERE presence = 0 AND created_uptime_s > ?', now - CEILING_WINDOW_S) ?? 0);
        if (recent >= NETWORK_CEILING) {
          throw rateLimited(600, 'The bag is getting too many code requests from other phones. Tap "I am at the bag", then plug any USB stick into the bag.', { presenceAvailable: true });
        }
        const wait = createPerIp.take(req.sb.ip);
        if (wait > 0) throw rateLimited(wait, 'Too many code requests from this phone. Wait a little, or tap "I am at the bag".', { presenceAvailable: true });
      }
      const id = random128();
      let nonce = '';
      do nonce = crockford(randomBytes(5), 8);
      while (tx.get('SELECT 1 FROM override_request WHERE nonce = ?', nonce));
      tx.run(
        `INSERT INTO override_request (id, username, nonce, key_version, epoch, created_boot_seq, secret_sha256, presence, created_uptime_s, created_wall_at, created_clock_trust, attempts, state, client_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', ?)`,
        id,
        username,
        nonce,
        ctx.keys.override?.version ?? 0,
        Number(tx.value("SELECT value FROM bag_meta WHERE key = 'epoch'") ?? 0),
        ctx.boot.bootSeq,
        sha256Hex(secret),
        presence ? 1 : 0,
        now,
        nowIso(),
        ctx.clockTrust(),
        req.sb.ip,
      );
      // The username is audited as typed; whether it exists is never revealed to the caller.
      tx.audit({ action: 'admin.override.request', targetType: 'override_request', targetId: id, detail: { username, presence }, clientIp: req.sb.ip });
      return tx.get<RequestRow>('SELECT * FROM override_request WHERE id = ?', id) as RequestRow;
    });
    // The request can live for days of calendar time (72 h of uptime, 20 boots); the cookie must outlive the browser session.
    setCookie(res, REQUEST_COOKIE, secret, { path: OVERRIDE_PATH, maxAgeS: 30 * 24 * 3600 });
    clearCookie(res, PRESENCE_COOKIE, OVERRIDE_PATH);
    sendJson(res, 201, body(ctx, created, 'open'));
  });

  router.get('/admin/override/requests/:requestId', async (req, res) => {
    const found = await ctx.write((tx) => ownedRequest(ctx, tx, req, pathParam(req, 'requestId')));
    sendJson(res, 200, body(ctx, found.row, found.state));
  });

  router.post('/admin/override/requests/:requestId/send-online', async (req, res) => {
    await ctx.write((tx) => ownedRequest(ctx, tx, req, pathParam(req, 'requestId')));
    // Phase 2 (EasySTEM reset service) is not built. The offline path never depends on it.
    throw new ApiError(503, 'offline', 'The bag could not reach EasySTEM. Read the code to them by phone instead.');
  });

  /* ---- enter the code ---- */
  router.post('/admin/override/redeem', async (req, res) => {
    const input = asObject(req.sb.body);
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const code = typeof input.code === 'string' ? input.code : null;
    if (!requestId || !username) throw invalid('The code request is missing. Ask for a new code.');
    if (code !== null && (code.length < 10 || code.length > 16)) throw invalid('Type the 10 characters of the code.', { code: 'The code has 10 characters.' });

    type Result = { ok: true; token: string; session: unknown } | { ok: false; error: ApiError };
    // One transaction decides and records the outcome, so a wrong attempt is on storage before the answer (V-034).
    const result = await ctx.write((tx): Result => {
      const { row, state } = ownedRequest(ctx, tx, req, requestId);
      if (state !== 'open' && state !== 'code-received') {
        return { ok: false, error: new ApiError(410, 'expired', "This code can't be used any more. Ask for a new code.", { details: { state } }) };
      }
      const given = code ?? row.received_code;
      if (given === null) return { ok: false, error: invalid('Type the code EasySTEM gave you.', { code: 'Type the code.' }) };
      const account = tx.get<{ id: string; username: string; display_name: string; role: 'hub_manager' | 'admin' }>(
        'SELECT id, username, display_name, role FROM admin_account WHERE username = ? AND is_active = 1',
        row.username,
      );
      const key = ctx.keys.override;
      const expected = key && key.version === row.key_version ? overrideCode(key.key, ctx.meta('bag_id') ?? '', row.key_version, row.nonce, row.username) : null;
      const sameUser = row.username.toLowerCase() === username.toLowerCase();
      const match = safeEqual(normaliseCode(given), expected ?? '\u0000no-code');
      if (!account || expected === null || !sameUser || !match) {
        const attempts = row.attempts + 1;
        const nowVoid = attempts >= MAX_ATTEMPTS;
        tx.run('UPDATE override_request SET attempts = ?, state = ? WHERE id = ?', attempts, nowVoid ? 'void' : state, row.id);
        tx.audit({ action: 'admin.override.refused', targetType: 'override_request', targetId: row.id, outcome: 'refused', detail: { attempts, void: nowVoid }, clientIp: req.sb.ip });
        return {
          ok: false,
          error: new ApiError(401, 'bad_code', nowVoid ? "That code is not right. This request can't be used any more. Ask for a new code." : `That code is not right. ${MAX_ATTEMPTS - attempts} tries left.`, {
            details: { attemptsLeft: MAX_ATTEMPTS - attempts },
          }),
        };
      }
      const now = nowIso();
      tx.run("UPDATE override_request SET state = 'used', used_at = ?, received_code = NULL WHERE id = ?", now, row.id);
      // The forgotten password is void from this moment: the only way on is to set a new one.
      tx.run(
        'UPDATE admin_account SET password_hash = ?, must_change_password = 1, failed_count = 0, locked_until = NULL, seq = ? WHERE id = ?',
        OVERRIDE_MARKER + row.id,
        tx.seq(),
        account.id,
      );
      endSessionsOf(tx, account.id, null);
      const token = createSession(ctx, tx, account.id, req.sb.ip, { idleMs: RESTRICTED_SESSION_MS, absoluteMs: RESTRICTED_SESSION_MS });
      tx.run('INSERT INTO override_notice (id, request_id, username, used_at) VALUES (?, ?, ?, ?)', newId('nt'), row.id, account.username, now);
      tx.audit({ actorId: account.id, actorName: account.username, action: 'admin.override.used', targetType: 'override_request', targetId: row.id, detail: { presence: row.presence === 1 }, clientIp: req.sb.ip });
      return { ok: true, token, session: { username: account.username, displayName: account.display_name, role: account.role, mustChangePassword: true } };
    });
    if (!result.ok) throw result.error;
    setCookie(res, SESSION_COOKIE, result.token, { path: '/', maxAgeS: RESTRICTED_SESSION_MS / 1000 });
    clearCookie(res, REQUEST_COOKIE, OVERRIDE_PATH);
    sendJson(res, 200, result.session);
  });

  /* ---- a hub manager acknowledges the banner ---- */
  router.post('/admin/override/notices/:noticeId/ack', requireAdmin(ctx, 'hub-manager'), async (req, res) => {
    const admin = req.sb.admin as AdminIdentity;
    await ctx.write((tx) => {
      const notice = tx.get<{ id: string; acknowledged_at: string | null }>('SELECT id, acknowledged_at FROM override_notice WHERE id = ?', pathParam(req, 'noticeId'));
      if (!notice) throw notFound('This notice');
      if (notice.acknowledged_at) return;
      tx.run('UPDATE override_notice SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?', admin.id, nowIso(), notice.id);
      tx.audit({ actorId: admin.id, actorName: admin.username, action: 'admin.override.ack', targetType: 'override_notice', targetId: notice.id, clientIp: req.sb.ip });
    });
    sendNoContent(res);
  });

  return router;
}
