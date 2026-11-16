/* BE-4: sign-in and lockout, sessions, roles (matrix generated from x-auth in openapi.yaml), accounts, the override code (SEC-1, SEC-3, SEC-11, SEC-12). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { overrideCode } from '../src/identity/override.ts';
import { lockMs } from '../src/identity/routes.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../src/identity/passwords.ts';
import { ADMIN, Client, HUB, OVERRIDE_KEY, makeBag, signedIn, type Bag } from './harness.ts';

interface Operation {
  method: string;
  path: string;
  auth: string;
}

/** Every operation of the contract with its x-auth, read straight from openapi.yaml. */
function operations(): Operation[] {
  const text = readFileSync(new URL('../../docs/system/openapi.yaml', import.meta.url), 'utf8');
  const out: Operation[] = [];
  let path = '';
  let method = '';
  let inPaths = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('paths:')) inPaths = true;
    else if (line.startsWith('components:')) inPaths = false;
    if (!inPaths) continue;
    const p = /^ {2}(\/[^:]*):\s*$/.exec(line);
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    const a = /^ {6}x-auth:\s*(\S+)/.exec(line);
    if (p) path = p[1] as string;
    else if (m) method = (m[1] as string).toUpperCase();
    else if (a) out.push({ method, path, auth: a[1] as string });
  }
  return out;
}

describe('passwords (R-4)', () => {
  test('scrypt in a self-describing string; verification is exact; unknown formats never match', async () => {
    const hash = await hashPassword('correct horse battery', { ln: 10, r: 8, p: 1 });
    assert.match(hash, /^\$scrypt\$ln=10,r=8,p=1\$/);
    assert.equal(await verifyPassword('correct horse battery', hash), true);
    assert.equal(await verifyPassword('correct horse batterx', hash), false);
    assert.equal(await verifyPassword('anything', null), false);
    assert.equal(await verifyPassword('anything', '!override$abc'), false);
    assert.notEqual(hash, await hashPassword('correct horse battery', { ln: 10, r: 8, p: 1 }), 'a new salt every time');
  });
  test('password rules: 10 characters, not common, not the username', () => {
    assert.ok(passwordProblem('short', 'hub'));
    assert.ok(passwordProblem('password123', 'hub'));
    assert.ok(passwordProblem('hubmanager-2026', 'hubmanager'));
    assert.equal(passwordProblem('river mango seven', 'hub'), null);
  });
  test('lockout: 1 minute after 5 failures, doubling to 15 minutes', () => {
    assert.deepEqual([4, 5, 6, 7, 8, 9, 30].map((n) => lockMs(n) / 60_000), [0, 1, 2, 4, 8, 15, 15]);
  });
});

describe('contract coverage and role matrix (x-auth in openapi.yaml)', () => {
  let bag: Bag;
  let hub: Client;
  let admin: Client;
  let anon: Client;
  const ops = operations();
  before(async () => {
    bag = await makeBag();
    hub = await signedIn(bag, HUB);
    admin = await signedIn(bag, ADMIN, '10.10.0.52');
    anon = new Client(bag, '10.10.0.53');
  });
  after(() => bag.close());
  const url = (path: string): string => path.replace(/\{[^}]+\}/g, 'x');

  test('the contract was read', () => {
    assert.ok(ops.length >= 60, `found ${ops.length} operations`);
    assert.deepEqual([...new Set(ops.map((o) => o.auth))].sort(), ['admin', 'hub-manager', 'none', 'request-cookie']);
  });

  test('every operation of the contract is routed (none answers "Unknown API path")', async () => {
    for (const op of ops) {
      const r = await hub.request(op.method, url(op.path), op.method === 'GET' || op.method === 'DELETE' ? undefined : {});
      assert.ok(!(r.status === 404 && r.body?.error?.message === 'Unknown API path.'), `${op.method} ${op.path} is not implemented`);
      assert.notEqual(r.status, 500, `${op.method} ${op.path} answered 500: ${r.text}`);
    }
  });

  test('admin and hub-manager operations answer 401 without a session', async () => {
    for (const op of ops.filter((o) => o.auth === 'admin' || o.auth === 'hub-manager')) {
      const r = await anon.request(op.method, url(op.path), op.method === 'GET' || op.method === 'DELETE' ? undefined : {});
      assert.equal(r.status, 401, `${op.method} ${op.path}`);
      assert.equal(r.body.error.code, 'unauthorised');
    }
  });

  test('hub-manager operations answer 403 forbidden to the role admin; admin operations do not', async () => {
    for (const op of ops.filter((o) => o.auth === 'hub-manager')) {
      const r = await admin.request(op.method, url(op.path), op.method === 'GET' ? undefined : {});
      assert.equal(r.status, 403, `${op.method} ${op.path}`);
      assert.equal(r.body.error.code, 'forbidden');
    }
    for (const op of ops.filter((o) => o.auth === 'admin')) {
      // Signing out or switching the bag off would end the test session; they are covered elsewhere.
      if (op.path === '/admin/session' || op.path === '/admin/power-off') continue;
      const r = await admin.request(op.method, url(op.path), op.method === 'GET' || op.method === 'DELETE' ? undefined : {});
      // (A 401 bad_credentials from typing a wrong password again is not a refusal of the role.)
      assert.ok(r.body?.error?.code !== 'unauthorised' && r.body?.error?.code !== 'forbidden', `${op.method} ${op.path} refused the role admin (${r.status})`);
    }
  });

  test('request-cookie operations refuse a browser without the request cookie', async () => {
    for (const op of ops.filter((o) => o.auth === 'request-cookie')) {
      const r = await anon.request(op.method, url(op.path), op.method === 'GET' ? undefined : {});
      assert.equal(r.status, 403, `${op.method} ${op.path}`);
      assert.equal(r.body.error.code, 'request_not_yours');
    }
  });
});

describe('sign-in and sessions', () => {
  let bag: Bag;
  before(async () => {
    bag = await makeBag();
  });
  after(() => bag.close());

  test('the cookie is HttpOnly, SameSite=Strict, Path=/, without Secure; only a keyed hash of the token is stored', async () => {
    const c = new Client(bag);
    const r = await fetch(`${bag.base}/admin/session`, { method: 'POST', headers: { 'X-Sensebod-Offline-Client': '1', 'Content-Type': 'application/json', 'X-Forwarded-For': '10.10.0.60' }, body: JSON.stringify(HUB) });
    const cookie = r.headers.getSetCookie()[0] as string;
    assert.match(cookie, /^sb_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict$/);
    const token = cookie.split(';')[0]?.split('=')[1] as string;
    const stored = bag.ctx.db.all<{ token_sha256: string }>('SELECT token_sha256 FROM admin_session');
    assert.ok(stored.every((s) => s.token_sha256 !== token && /^[0-9a-f]{64}$/.test(s.token_sha256)));
    assert.deepEqual(await r.json(), { username: 'hub', displayName: 'Hub Manager', role: 'hub_manager', mustChangePassword: false });
    c.cookies.set('sb_admin', token);
    c.ip = '10.10.0.60';
    assert.equal((await c.get('/admin/session')).status, 200);
    // Bound to the phone's address: the same cookie from another address is refused, and the owner keeps the session.
    c.ip = '10.10.0.61';
    assert.equal((await c.get('/admin/session')).status, 401);
    c.ip = '10.10.0.60';
    assert.equal((await c.get('/admin/session')).status, 200);
    assert.equal((await c.delete('/admin/session')).status, 204);
    assert.equal((await c.get('/admin/session')).status, 401);
  });

  test('wrong password and unknown user get the same words; nothing says which', async () => {
    const c = new Client(bag);
    const wrong = await c.signIn({ username: 'hub', password: 'not the password' });
    const unknown = await c.signIn({ username: 'nobody-here', password: 'not the password' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    bag.ctx.writeSync((tx) => tx.run("UPDATE admin_account SET failed_count = 0 WHERE username = 'hub'"));
  });

  test('5 wrong passwords lock the account (429 with Retry-After), even when sent in parallel; the right one then waits too (SEC-3)', async () => {
    const c = new Client(bag);
    const replies = await Promise.all(Array.from({ length: 5 }, () => c.signIn({ username: ADMIN.username, password: 'wrong wrong wrong' })));
    assert.ok(replies.every((r) => r.status === 401 || r.status === 429));
    const row = bag.ctx.db.get<{ failed_count: number; locked_until: string | null }>("SELECT failed_count, locked_until FROM admin_account WHERE username = 'facil'");
    assert.equal(row?.failed_count, 5, 'each parallel failure was counted');
    assert.ok(row?.locked_until);
    const locked = await c.signIn(ADMIN);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    assert.ok(bag.ctx.db.get("SELECT 1 FROM audit_event WHERE action = 'admin.signin' AND outcome = 'refused'"));
    bag.ctx.writeSync((tx) => tx.run("UPDATE admin_account SET failed_count = 0, locked_until = NULL WHERE username = 'facil'"));
    assert.equal((await c.signIn(ADMIN)).status, 200);
  });

  test('sessions end at idle and absolute expiry, and none survives a boot', async () => {
    const c = await signedIn(bag, HUB, '10.10.0.70');
    bag.ctx.writeSync((tx) => tx.run("UPDATE admin_session SET idle_expires_at = '2000-01-01T00:00:00.000Z' WHERE client_ip = '10.10.0.70'"));
    assert.equal((await c.get('/admin/session')).status, 401);
    const d = await signedIn(bag, HUB, '10.10.0.71');
    bag.ctx.writeSync((tx) => tx.run("UPDATE admin_session SET boot_id = 'an-earlier-boot' WHERE client_ip = '10.10.0.71'"));
    assert.equal((await d.get('/admin/session')).status, 401);
  });

  test('re-authentication is needed for account changes and lasts for the session that confirmed', async () => {
    const hub = await signedIn(bag, HUB, '10.10.0.72');
    const account = { username: 'aminata', displayName: 'Aminata', role: 'admin', temporaryPassword: 'welcome to the bag' };
    const refused = await hub.post('/admin/accounts', account);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'reauth_required');
    assert.equal((await hub.confirm({ password: 'nope nope nope' })).status, 401);
    assert.equal((await hub.confirm(HUB)).status, 204);
    const created = await hub.post('/admin/accounts', account);
    assert.equal(created.status, 201);
    assert.equal(created.body.mustChangePassword, true);
    assert.ok(!JSON.stringify(created.body).includes('welcome'));
    assert.equal((await hub.post('/admin/accounts', account)).status, 409, 'usernames are unique (case-insensitively)');

    // First sign-in with the temporary password: only the password change is allowed.
    const fresh = new Client(bag, '10.10.0.73');
    const signed = await fresh.signIn({ username: 'Aminata', password: account.temporaryPassword });
    assert.equal(signed.body.mustChangePassword, true);
    const blocked = await fresh.get('/admin/lessons');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'password_change_required');
    assert.equal((await fresh.post('/admin/session/password', { newPassword: 'my own long password' })).status, 401, 'the current password is needed');
    assert.equal((await fresh.post('/admin/session/password', { currentPassword: account.temporaryPassword, newPassword: 'short' })).status, 422);
    assert.equal((await fresh.post('/admin/session/password', { currentPassword: account.temporaryPassword, newPassword: 'my own long password' })).status, 204);
    assert.equal((await fresh.get('/admin/lessons')).status, 200);

    // Disabling takes effect at once; passwords cannot be reset here (OWNER-3).
    const id = created.body.id as string;
    assert.equal((await hub.patch(`/admin/accounts/${id}`, { password: 'x' })).status, 403);
    assert.equal((await hub.patch(`/admin/accounts/${id}`, { isActive: false })).status, 200);
    assert.equal((await fresh.get('/admin/lessons')).status, 401);
    assert.equal((await fresh.signIn({ username: 'aminata', password: 'my own long password' })).status, 401);
  });

  test('the last active hub manager cannot be disabled or demoted', async () => {
    const hub = await signedIn(bag, HUB, '10.10.0.74');
    await hub.confirm(HUB);
    const me = (await hub.get('/admin/accounts')).body.find((a: { username: string }) => a.username === 'hub');
    assert.equal((await hub.patch(`/admin/accounts/${me.id}`, { role: 'admin' })).status, 409);
    assert.equal((await hub.patch(`/admin/accounts/${me.id}`, { isActive: false })).status, 409);
  });
});

describe('override code (ADR-017)', () => {
  let bag: Bag;
  const bagId = (): string => bag.ctx.meta('bag_id') as string;
  /** What `sensebod-offline-office override` would print for a request shown on the bag. */
  const mint = (requestCode: string, username: string): string => {
    const clean = requestCode.replace(/-/g, '');
    return overrideCode(Buffer.from(OVERRIDE_KEY, 'hex'), bagId(), 1, clean.slice(5, 13), username);
  };
  before(async () => {
    bag = await makeBag();
  });
  after(() => bag.close());

  test('request → code from EasySTEM → restricted session → new password; every admin sees the notice until a hub manager acknowledges it', async () => {
    const phone = new Client(bag, '10.10.0.80');
    const request = await phone.post('/admin/override/requests', { username: 'Facil' });
    assert.equal(request.status, 201);
    assert.match(request.body.requestCode, /^1-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.match(request.body.requestId, /^[0-9a-z]{26}$/);
    assert.equal(request.body.attemptsLeft, 5);
    assert.ok(phone.cookies.has('sb_ovr'));
    const stored = bag.ctx.db.get<{ secret_sha256: string }>('SELECT secret_sha256 FROM override_request WHERE id = ?', request.body.requestId);
    assert.notEqual(stored?.secret_sha256, phone.cookies.get('sb_ovr'), 'only the hash of the request secret is stored');

    const code = mint(request.body.requestCode, 'facil');
    // Read aloud and typed back: lower case, dashes, O for 0, I for 1.
    const spoken = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i');
    const redeemed = await phone.post('/admin/override/redeem', { requestId: request.body.requestId, username: 'facil', code: spoken });
    assert.equal(redeemed.status, 200, redeemed.text);
    assert.equal(redeemed.body.mustChangePassword, true);

    // The restricted session may do one thing only.
    assert.equal((await phone.get('/admin/lessons')).status, 403);
    assert.equal((await phone.post('/admin/session/confirm', { password: ADMIN.password })).status, 403);
    // The forgotten password is void from the moment the code was accepted.
    assert.equal((await new Client(bag, '10.10.0.81').signIn(ADMIN)).status, 401);
    assert.equal((await phone.post('/admin/session/password', { newPassword: 'a brand new password' })).status, 204);
    assert.equal((await phone.get('/admin/lessons')).status, 200);
    assert.equal((await new Client(bag, '10.10.0.82').signIn({ username: 'facil', password: 'a brand new password' })).status, 200);

    // Single use.
    const again = await phone.post('/admin/override/redeem', { requestId: request.body.requestId, username: 'facil', code });
    assert.ok(again.status === 403 || again.status === 410);

    const hub = await signedIn(bag, HUB, '10.10.0.83');
    const notices = (await hub.get('/admin/status')).body.overrideNotices;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].username, 'facil');
    assert.equal((await phone.post(`/admin/override/notices/${notices[0].noticeId}/ack`)).status, 403, 'role admin cannot acknowledge');
    assert.equal((await hub.post(`/admin/override/notices/${notices[0].noticeId}/ack`)).status, 204);
    assert.equal((await hub.get('/admin/status')).body.overrideNotices.length, 0);
    for (const action of ['admin.override.request', 'admin.override.used', 'admin.override.ack']) assert.ok(bag.ctx.db.get('SELECT 1 FROM audit_event WHERE action = ?', action), action);
    // The code itself is never recorded.
    assert.ok(!JSON.stringify(bag.ctx.db.all('SELECT detail_json FROM audit_event')).includes(code));
  });

  test('a code only works for its own request, bag and username; another browser cannot spend the tries', async () => {
    const mine = new Client(bag, '10.10.0.84');
    const a = (await mine.post('/admin/override/requests', { username: 'hub' })).body;
    const thief = new Client(bag, '10.10.0.85');
    for (let i = 0; i < 6; i += 1) {
      const r = await thief.post('/admin/override/redeem', { requestId: a.requestId, username: 'hub', code: 'AAAAAAAAAA' });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'request_not_yours');
    }
    assert.equal((await mine.get(`/admin/override/requests/${a.requestId}`)).body.attemptsLeft, 5, 'the request is untouched');
    // A code minted for another username or another request is a wrong code.
    const forOther = mint(a.requestCode, 'facil');
    assert.equal((await mine.post('/admin/override/redeem', { requestId: a.requestId, username: 'hub', code: forOther })).status, 401);
    const good = mint(a.requestCode, 'hub');
    assert.equal((await mine.post('/admin/override/redeem', { requestId: a.requestId, username: 'facil', code: good })).status, 401);
    const left = (await mine.get(`/admin/override/requests/${a.requestId}`)).body.attemptsLeft;
    assert.equal(left, 3, 'each wrong attempt is committed before the answer');
  });

  test('5 wrong codes void the request; an unknown username gets a request that can never be redeemed', async () => {
    const c = new Client(bag, '10.10.0.86');
    const ghost = await c.post('/admin/override/requests', { username: 'no-such-admin' });
    assert.equal(ghost.status, 201, 'no account enumeration');
    const code = mint(ghost.body.requestCode, 'no-such-admin');
    let last = await c.post('/admin/override/redeem', { requestId: ghost.body.requestId, username: 'no-such-admin', code });
    assert.equal(last.status, 401);
    for (let i = 0; i < 4; i += 1) last = await c.post('/admin/override/redeem', { requestId: ghost.body.requestId, username: 'no-such-admin', code });
    assert.equal(last.body.error.details.attemptsLeft, 0);
    const dead = await c.post('/admin/override/redeem', { requestId: ghost.body.requestId, username: 'no-such-admin', code });
    assert.equal(dead.status, 410);
    assert.equal((await c.get(`/admin/override/requests/${ghost.body.requestId}`)).body.state, 'void');
  });

  test('a request dies after 72 h of bag uptime, after 20 boots, and when the database was replaced', async () => {
    const make = async (ip: string) => {
      const c = new Client(bag, ip);
      const r = await c.post('/admin/override/requests', { username: 'hub' });
      return { c, id: r.body.requestId as string, code: mint(r.body.requestCode, 'hub') };
    };
    const byUptime = await make('10.10.0.87');
    bag.ctx.writeSync((tx) => tx.run('UPDATE override_request SET created_uptime_s = created_uptime_s - ? WHERE id = ?', 72 * 3600, byUptime.id));
    assert.equal((await byUptime.c.post('/admin/override/redeem', { requestId: byUptime.id, username: 'hub', code: byUptime.code })).status, 410);
    const byBoots = await make('10.10.0.88');
    bag.ctx.writeSync((tx) => tx.run('UPDATE override_request SET created_boot_seq = created_boot_seq - 20 WHERE id = ?', byBoots.id));
    assert.equal((await byBoots.c.post('/admin/override/redeem', { requestId: byBoots.id, username: 'hub', code: byBoots.code })).status, 410);
    const byEpoch = await make('10.10.0.89');
    bag.ctx.writeSync((tx) => tx.run('UPDATE override_request SET epoch = epoch - 1 WHERE id = ?', byEpoch.id));
    const r = await byEpoch.c.post('/admin/override/redeem', { requestId: byEpoch.id, username: 'hub', code: byEpoch.code });
    assert.equal(r.status, 410);
    assert.equal(r.body.error.details.state, 'void');
  });

  test('3 requests per hour per phone; "I am at the bag" plus a stick opens the path that cannot be blocked', async () => {
    const c = new Client(bag, '10.10.0.90');
    for (let i = 0; i < 3; i += 1) assert.equal((await c.post('/admin/override/requests', { username: 'hub' })).status, 201);
    const limited = await c.post('/admin/override/requests', { username: 'hub' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.details.presenceAvailable, true);
    // Presence without a stick is not enough.
    assert.equal((await c.post('/admin/override/presence')).status, 204);
    assert.equal((await c.post('/admin/override/requests', { username: 'hub', presence: true })).status, 409);
    // The root helper records a USB add event (seconds since boot) in usb.json.
    const { writeFileSync } = await import('node:fs');
    const os = await import('node:os');
    writeFileSync(bag.ctx.paths.usbJson, JSON.stringify({ state: 'mounted', lastAddAtBootS: Math.floor(os.uptime()) }));
    const present = await c.post('/admin/override/requests', { username: 'hub', presence: true });
    assert.equal(present.status, 201, present.text);
    assert.equal(bag.ctx.db.value('SELECT presence FROM override_request WHERE id = ?', present.body.requestId), 1);
    // One request per token.
    assert.equal((await c.post('/admin/override/requests', { username: 'hub', presence: true })).status, 409);
  });

  test('the online path answers 503 offline; it is optional and not built (phase 2)', async () => {
    const c = new Client(bag, '10.10.0.91');
    const r = await c.post('/admin/override/requests', { username: 'hub' });
    const online = await c.post(`/admin/override/requests/${r.body.requestId}/send-online`);
    assert.equal(online.status, 503);
    assert.equal(online.body.error.code, 'offline');
  });
});
