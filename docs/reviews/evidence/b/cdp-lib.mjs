/*
 * Reviewer B: minimal Chrome DevTools Protocol client (no dependencies; Node 22+ has WebSocket).
 * Used by the cdp-*.mjs audits in this folder.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts a headless Chrome whose DNS can only resolve loopback: any request to the internet fails visibly. */
export async function launchChrome({ port = 49222, binary = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args = [] } = {}) {
  const profile = mkdtempSync(path.join(process.env.CHROME_TMP || tmpdir(), 'review-b-chrome-'));
  const child = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      ...args,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 100; i += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return { child, profile, info, port, close: () => { child.kill('SIGKILL'); try { rmSync(profile, { recursive: true, force: true }); } catch {} } };
    } catch {
      await sleep(100);
    }
  }
  child.kill('SIGKILL');
  throw new Error('Chrome did not start');
}

/** Connects to a browser's debugging endpoint. Works with old Chromium too (no flat sessions needed). */
export async function connectPage(port, { host = '127.0.0.1', newTab = true, match = null } = {}) {
  let target;
  if (match) {
    // an existing target, e.g. an out-of-process iframe: match(target) => boolean
    target = (await (await fetch(`http://${host}:${port}/json/list`)).json()).find(match);
    if (!target) throw new Error('no such target');
  } else if (newTab) {
    const res = await fetch(`http://${host}:${port}/json/new?about:blank`, { method: 'PUT' }).catch(() => null);
    if (res && res.ok) target = await res.json();
    else target = await (await fetch(`http://${host}:${port}/json/new?about:blank`)).json();
  } else {
    target = (await (await fetch(`http://${host}:${port}/json/list`)).json()).find((t) => t.type === 'page');
  }
  const wsUrl = target.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${host}:${port}`);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + ' ' + (msg.error.data || '')));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const h of handlers.get(msg.method) || []) h(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { id += 1; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const on = (method, handler) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(handler); };
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const close = async () => { try { await fetch(`http://${host}:${port}/json/close/${target.id}`); } catch {} ws.close(); };
  return { send, on, evaluate, close, targetId: target.id };
}

/** Records every request a page makes, with status, size on the wire and cache use. */
export function recordNetwork(page) {
  const requests = new Map();
  const log = { requests, console: [], exceptions: [], violations: [] };
  page.on('Network.requestWillBeSent', (p) => {
    requests.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type, start: p.timestamp, initiator: p.initiator?.type, status: null, encoded: 0, fromCache: false, failed: null, encoding: null, mime: null });
  });
  page.on('Network.responseReceived', (p) => {
    const r = requests.get(p.requestId);
    if (!r) return;
    r.status = p.response.status;
    r.mime = p.response.mimeType;
    r.fromCache = !!p.response.fromDiskCache;
    const h = p.response.headers || {};
    r.encoding = h['Content-Encoding'] || h['content-encoding'] || null;
    r.cacheControl = h['Cache-Control'] || h['cache-control'] || null;
    r.type = p.type || r.type;
  });
  page.on('Network.requestServedFromCache', (p) => { const r = requests.get(p.requestId); if (r) r.fromCache = true; });
  page.on('Network.loadingFinished', (p) => { const r = requests.get(p.requestId); if (r) { r.encoded = p.encodedDataLength; r.end = p.timestamp; } });
  page.on('Network.loadingFailed', (p) => { const r = requests.get(p.requestId); if (r) { r.failed = p.errorText + (p.blockedReason ? ' (' + p.blockedReason + ')' : ''); r.end = p.timestamp; } });
  page.on('Runtime.consoleAPICalled', (p) => log.console.push(p.type + ': ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ')));
  page.on('Runtime.exceptionThrown', (p) => log.exceptions.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  page.on('Log.entryAdded', (p) => { if (p.entry.level === 'error' || p.entry.level === 'warning' || p.entry.source === 'security') log.violations.push(p.entry.source + '/' + p.entry.level + ': ' + p.entry.text + (p.entry.url ? ' [' + p.entry.url + ']' : '')); });
  return log;
}

export async function enableAll(page) {
  await page.send('Network.enable');
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable').catch(() => {});
}

export async function waitFor(page, expression, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(expression).catch(() => false)) return Date.now() - start;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + expression);
    await sleep(50);
  }
}
