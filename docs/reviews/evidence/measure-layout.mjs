/*
 * Reviewer A: layout, touch-target, focus and chunk-recovery measurements in
 * headless Chrome through the DevTools protocol. No dependencies (Node 22+
 * for the built-in WebSocket).
 *
 *   cd app && npx vite --port 5199 --strictPort            # dev server (kitchen sink)
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reviews/evidence/measure-layout.mjs > docs/reviews/evidence/measure-layout.out.txt
 *
 * Current desktop Chrome only: this says nothing about Chrome 58 or Android.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEV = process.env.DEV_URL ?? 'http://localhost:5199';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9347;

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
async function open(url, width, height = 740) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await sleep(1800);
}

await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');

/* ---- 1. horizontal overflow and small touch targets ---- */
const MEASURE = `(() => {
  const vw = window.innerWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  const controls = [...document.querySelectorAll('a[href], button, input, textarea, select, [role=radio], [role=button]')].filter(visible);
  const small = controls.map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().split(' ')[0], name: name(el), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((c) => c.w < 48 || c.h < 48);
  const outside = [...document.querySelectorAll('body *')].filter(visible).filter((el) => el.getBoundingClientRect().right > vw + 0.5).map((el) => ({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().split(' ')[0], right: Math.round(el.getBoundingClientRect().right) })).slice(0, 6);
  let minFont = 99; let minFontEl = '';
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < minFont) { minFont = size; minFontEl = el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' "' + el.textContent.trim().slice(0, 24) + '"'; }
  }
  return { vw, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > vw, controls: controls.length, small, outside, minFont, minFontEl };
})()`;

const pages = [
  ['Home (learner stub, PageShell home)', `${BUILT}/`],
  ['Lesson, Child protection (quick exit shell)', `${BUILT}/lesson/cp-child-staying-safe-1`],
  ['Lesson, Agriculture (single-row inner shell)', `${BUILT}/lesson/agriculture-chickens-and-quail-videos-1`],
  ['Not found (inner shell)', `${BUILT}/portal/nowhere`],
  ['Admin stub', `${BUILT}/admin`],
  ['Kitchen sink (dev server, every shared component)', `${DEV}/__dev`],
];

console.log('## 1. Overflow, touch targets (< 48px), smallest text\n');
for (const [label, url] of pages) {
  for (const width of [320, 360, 390, 800]) {
    await open(url, width);
    const m = await evaluate(MEASURE);
    console.log(`${label} @ ${width}px: scrollWidth ${m.scrollWidth}${m.overflowX ? '  ** HORIZONTAL OVERFLOW **' : ''}; controls ${m.controls}; smallest text ${m.minFont}px (${m.minFontEl})`);
    for (const o of m.outside) console.log(`    past the right edge: <${o.tag}.${o.cls}> right=${o.right}`);
    for (const s of m.small) console.log(`    small target: <${s.tag}.${s.cls}> "${s.name}" ${s.w}x${s.h}`);
  }
}

/* ---- 2. focus after in-app navigation ---- */
console.log('\n## 2. Focus after in-app navigation\n');
await open(`${BUILT}/`, 390);
await evaluate(`(() => { const a = document.querySelector('a.sb-card'); a.focus(); a.click(); })()`);
await sleep(800);
console.log('after tapping a portal card:', await evaluate(`JSON.stringify({ path: location.pathname, activeElement: document.activeElement && (document.activeElement.id || document.activeElement.tagName), title: document.title, scrollY: window.scrollY })`));

/* ---- 3. a feature chunk that fails to download, then the network returns ---- */
console.log('\n## 3. Failed feature download, then the network comes back (production build)\n');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await open(`${BUILT}/`, 390);
await send('Network.setBlockedURLs', { urls: ['*feature-lessons*'] });
await evaluate(`(() => { history.pushState(null, '', '/lesson/cp-child-staying-safe-1'); dispatchEvent(new PopStateEvent('popstate')); })()`);
await sleep(1500);
console.log('lessons chunk blocked, opened a lesson in-app →', await evaluate(`document.querySelector('main').innerText.replace(/\\n+/g, ' | ')`));
await send('Network.setBlockedURLs', { urls: [] });
await evaluate(`[...document.querySelectorAll('a')].find((a) => a.textContent.includes('Go to Home')).click()`);
await sleep(1000);
console.log('network restored, tapped "Go to Home" →', await evaluate(`location.pathname + ' :: ' + document.querySelector('h1, .sb-message__title').innerText`));
await evaluate(`(() => { history.pushState(null, '', '/lesson/cp-child-staying-safe-1'); dispatchEvent(new PopStateEvent('popstate')); })()`);
await sleep(1500);
console.log('opened the same lesson again in-app (network is fine) →', await evaluate(`document.querySelector('main').innerText.replace(/\\n+/g, ' | ')`));

await send('Network.setBlockedURLs', { urls: ['*feature-learner*'] });
await open(`${BUILT}/`, 390);
console.log('learner chunk blocked on first load of Home →', await evaluate(`document.querySelector('main') ? document.querySelector('main').innerText.replace(/\\n+/g, ' | ') : document.body.innerText`));
await send('Network.setBlockedURLs', { urls: [] });
await evaluate(`[...document.querySelectorAll('a')].find((a) => a.textContent.includes('Go to Home')).click()`);
await sleep(1200);
console.log('network restored, tapped "Go to Home" →', await evaluate(`document.querySelector('main').innerText.replace(/\\n+/g, ' | ')`));

/* ---- 4. placeholder text reaching learners ---- */
console.log('\n## 4. Bracket placeholders on screen\n');
await open(`${DEV}/__dev`, 390);
console.log('kitchen sink: occurrences of "[length]":', await evaluate(`(document.body.innerText.match(/\\[length\\]/g) || []).length`), '· "[pages]":', await evaluate(`(document.body.innerText.match(/\\[pages\\]/g) || []).length`));
await open(`${BUILT}/lesson/cp-child-staying-safe-quiz`, 390);
console.log('quiz lesson facts row:', await evaluate(`(document.querySelector('.sb-facts') || { innerText: '(none)' }).innerText.replace(/\\n+/g, ' | ')`));

ws.close();
chrome.kill();
