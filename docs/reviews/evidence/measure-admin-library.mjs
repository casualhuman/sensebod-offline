/*
 * Reviewer A, final pass: the admin Library at laptop widths (production
 * build, headless Chrome). Which widths scroll sideways, and what sticks out.
 *
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reviews/evidence/measure-admin-library.mjs > docs/reviews/evidence/measure-admin-library.out.txt
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9351;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'sb-review-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
async function connect() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}
const ws = await connect();
await new Promise((resolve) => ws.addEventListener('open', resolve));
let nextId = 1;
const waiting = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => waiting.set(id, resolve));
}
async function evaluate(expression) {
  const { result, error } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (error || result.exceptionDetails) throw new Error(JSON.stringify(error ?? result.exceptionDetails));
  return result.result.value;
}
async function open(url, width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 768, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1800);
}
await send('Page.enable');
await send('Runtime.enable');
await open(`${BUILT}/admin/sign-in`, 1280);
await evaluate(`fetch('/api/v1/admin/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'sensebod' }) }).then((r) => r.status)`);

const OUT = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5; })
    .map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' right=' + Math.round(el.getBoundingClientRect().right) + ' width=' + Math.round(el.getBoundingClientRect().width));
  return { vw, scrollWidth: document.documentElement.scrollWidth, first: out.slice(0, 5), count: out.length };
})()`;
for (const [label, url] of [
  ['Library, Child protection', `${BUILT}/admin/library?portalId=child-protection`],
  ['Library, Child protection, one series', `${BUILT}/admin/library?portalId=child-protection&groupId=cp-child&seriesId=cp-child-staying-safe`],
  ['Library, Agriculture', `${BUILT}/admin/library?portalId=agriculture`],
]) {
  for (const width of [1100, 1280, 1366, 1440, 1536]) {
    await open(url, width);
    const m = await evaluate(OUT);
    console.log(`${label} @ ${width}: scrollWidth ${m.scrollWidth}${m.scrollWidth > m.vw ? '  ** HORIZONTAL OVERFLOW ** ' + m.count + ' element(s) past the edge, first: ' + m.first.join(' ; ') : ''}`);
  }
}
ws.close();
chrome.kill();
