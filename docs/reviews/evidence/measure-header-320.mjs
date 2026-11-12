/*
 * Reviewer A: widths of the page-shell header rows on a 320px-wide phone
 * (480x854 screens at 1.5x, common on entry-level Android), production build.
 *
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reviews/evidence/measure-header-320.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9348;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'sb-review-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 50 && !ws; i += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = targets.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {
    await sleep(200);
  }
}
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
const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => waiting.set(id, resolve));
};
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value;

const ROWS = `(() => [...document.querySelectorAll('.sb-shell__bar')].map((bar) => ({
  bar: bar.className,
  barClientWidth: bar.clientWidth,
  barScrollWidth: bar.scrollWidth,
  children: [...bar.children].filter((c) => c.getBoundingClientRect().width > 0).map((c) => ({ what: (c.getAttribute('aria-label') || c.textContent || c.className).trim().slice(0, 18) || c.tagName, left: Math.round(c.getBoundingClientRect().left), right: Math.round(c.getBoundingClientRect().right), width: Math.round(c.getBoundingClientRect().width) })),
  headerHeight: Math.round(document.querySelector('.sb-shell__header').getBoundingClientRect().height),
  position: getComputedStyle(document.querySelector('.sb-shell__header')).position,
})))()`;

for (const [label, url] of [
  ['single-row inner header (Agriculture lesson)', `${BUILT}/lesson/agriculture-chickens-and-quail-videos-1`],
  ['quick-exit header (Child protection lesson)', `${BUILT}/lesson/cp-child-staying-safe-1`],
]) {
  for (const width of [320, 360]) {
    // mobile:false keeps the layout viewport at the device width, so overflow shows as it is laid out.
    await send('Emulation.setDeviceMetricsOverride', { width, height: 569, deviceScaleFactor: 1.5, mobile: false });
    await send('Page.navigate', { url });
    await sleep(1800);
    console.log(`\n${label} @ ${width}px wide, 569px tall`);
    console.log(JSON.stringify(await evaluate(ROWS), null, 1));
    console.log('document scrollWidth:', await evaluate('document.documentElement.scrollWidth'));
  }
}
ws.close();
chrome.kill();
