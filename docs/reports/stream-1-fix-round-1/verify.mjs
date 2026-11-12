/*
 * Stream 1, fix round 1: checks in headless Chrome against the served
 * production build, through the DevTools protocol. No dependencies (Node 22+
 * for the built-in WebSocket). Not part of the app or its test run.
 *
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reports/stream-1-fix-round-1/verify.mjs > docs/reports/stream-1-fix-round-1/verify.out.txt
 *
 * 1. sideways overflow and header geometry at 320, 360 and 390px (A-06)
 * 2. focus and scroll position after in-app navigation
 * 3. a feature chunk that fails to download, and every way back (A-03),
 *    including a direct proof that SystemJS keeps the failed module
 *
 * Current desktop Chrome with device emulation only: this says nothing
 * about Chrome 58, Android or a Raspberry Pi.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9351;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'sb-s1-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

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
const requests = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
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
  await sleep(1600);
}
const count = (part) => requests.filter((url) => url.includes(part)).length;
const mainText = `(document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText).replace(/\\n+/g, ' | ').slice(0, 150)`;
const pushTo = (to) => `(() => { history.pushState(null, '', '${to}'); dispatchEvent(new PopStateEvent('popstate')); })()`;
const clickText = (text) => `[...document.querySelectorAll('a,button')].find((el) => el.textContent.includes('${text}')).click()`;

await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');

/* ---- 1. no sideways overflow at 320 and 360 ---- */
console.log('## 1. Sideways overflow and header geometry (production build)\n');
const MEASURE = `(() => {
  const vw = window.innerWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const outside = [...document.querySelectorAll('body *')].filter(visible).filter((el) => el.getBoundingClientRect().right > vw + 0.5).map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' right=' + Math.round(el.getBoundingClientRect().right)).slice(0, 4);
  const nav = document.querySelector('.sb-shell__bar--nav');
  const last = nav ? [...nav.children].filter(visible).pop() : null;
  const logo = document.querySelector('.sb-shell__logo-link');
  const bar = document.querySelector('.sb-listen-bar');
  const small = [...document.querySelectorAll('a[href], button')].filter(visible).map((el) => { const r = el.getBoundingClientRect(); return { n: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((c) => c.w < 48 || c.h < 48);
  return { vw, scrollWidth: document.documentElement.scrollWidth, outside, navRight: last ? Math.round(last.getBoundingClientRect().right) : null, logo: logo ? (visible(logo) ? Math.round(logo.getBoundingClientRect().width) + 'x' + Math.round(logo.getBoundingClientRect().height) : 'hidden') : 'none', listenBar: bar && visible(bar) ? getComputedStyle(bar).flexDirection + ' ' + Math.round(bar.getBoundingClientRect().right) : '-', small };
})()`;
const pages = ['/', '/save-progress', '/portal/primary', '/portal/primary/primary-class-4', '/portal/primary/primary-class-4/primary-class-4-mathematics', '/portal/jss/jss-2', '/portal/child-protection', '/portal/child-protection/cp-child', '/portal/child-protection/help', '/portal/agriculture', '/portal/agriculture/agriculture-chickens-and-quail', '/portal/climate', '/lesson/cp-child-staying-safe-1', '/lesson/agriculture-chickens-and-quail-videos-1', '/portal/nowhere', '/admin'];
let overflows = 0;
for (const page of pages) {
  for (const width of [320, 360, 390]) {
    await open(BUILT + page, width);
    const m = await evaluate(MEASURE);
    const over = m.scrollWidth > m.vw;
    if (over) overflows += 1;
    console.log(`${page} @ ${width}: scrollWidth ${m.scrollWidth}${over ? '  ** OVERFLOW **' : ''}; last item of nav row ends at ${m.navRight}; header logo link ${m.logo}; listen row ${m.listenBar}${m.outside.length ? '; outside: ' + m.outside.join(', ') : ''}${m.small.length ? '; small targets: ' + JSON.stringify(m.small) : ''}`);
  }
}
console.log(`\npages with sideways overflow: ${overflows}`);

/* ---- 2. focus and scroll after in-app navigation ---- */
console.log('\n## 2. Focus and scroll after in-app navigation\n');
await open(BUILT + '/', 390);
await evaluate(`(() => { const a = document.querySelector('a.sb-card'); a.focus(); a.click(); })()`);
await sleep(800);
console.log('after tapping a portal card:', await evaluate(`JSON.stringify({ path: location.pathname, activeElement: document.activeElement && (document.activeElement.id || document.activeElement.tagName), scrollY: window.scrollY })`));

/* ---- 3. chunk failure and recovery ---- */
console.log('\n## 3. Failed feature download and recovery (production build, SystemJS)\n');
await send('Network.setCacheDisabled', { cacheDisabled: true });

console.log('3a. lessons chunk fails; browser Back; network returns; the lesson is opened again in-app');
await open(BUILT + '/', 390);
await evaluate(`window.__sameLoad = true`);
requests.length = 0;
await send('Network.setBlockedURLs', { urls: ['*feature-lessons*'] });
await evaluate(pushTo('/lesson/cp-child-staying-safe-1'));
await sleep(1200);
console.log('  blocked, opened a lesson →', await evaluate(mainText), `· chunk requests: ${count('feature-lessons')}`);
await send('Network.setBlockedURLs', { urls: [] });
await evaluate(`history.back()`);
await sleep(600);
console.log('  browser Back →', await evaluate(`location.pathname + ' :: ' + ${mainText}`), `· same page load: ${await evaluate('window.__sameLoad === true')}`);
const before = count('feature-lessons');
const direct = await evaluate(`(async () => { const src = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('feature-lessons')) || ''; const started = performance.now(); try { await System.import(src); return 'resolved'; } catch (e) { return 'rejected again after ' + Math.round(performance.now() - started) + ' ms: ' + String(e.message).slice(0, 80); } })()`);
await sleep(300);
console.log(`  network is back; System.import of the same chunk, asked directly → ${direct} · new chunk requests: ${count('feature-lessons') - before}  (0 = the loader kept the failure)`);
await evaluate(pushTo('/lesson/cp-child-staying-safe-1'));
await sleep(2500);
console.log('  opened the lesson again in-app →', await evaluate(mainText), `· same page load: ${await evaluate('window.__sameLoad === true')} · reach checks: ${count('?reach=')} · chunk requests in total: ${count('feature-lessons')}`);

console.log('\n3b. lessons chunk fails, then the bag is out of reach: every way out stays on the Sensebod error screen');
await open(BUILT + '/', 390);
await evaluate(`window.__sameLoad = true`);
requests.length = 0;
await send('Network.setBlockedURLs', { urls: ['*feature-lessons*'] });
await evaluate(pushTo('/lesson/cp-child-staying-safe-1'));
await sleep(1200);
await send('Network.setBlockedURLs', { urls: ['*'] });
await evaluate(clickText('Try again'));
await sleep(1500);
console.log('  everything blocked, tapped "Try again" →', await evaluate(mainText), `· same page load: ${await evaluate('window.__sameLoad === true')} · path ${await evaluate('location.pathname')}`);
await evaluate(clickText('Go to Home'));
await sleep(1500);
console.log('  tapped "Go to Home" →', await evaluate(mainText), `· same page load: ${await evaluate('window.__sameLoad === true')} · path ${await evaluate('location.pathname')}`);
await evaluate(`document.querySelector('.sb-shell__bar--nav a').click()`);
await sleep(1500);
console.log('  tapped "Back" in the header →', await evaluate(mainText), `· same page load: ${await evaluate('window.__sameLoad === true')} · path ${await evaluate('location.pathname')}`);
await send('Network.setBlockedURLs', { urls: [] });
await evaluate(clickText('Try again'));
await sleep(2500);
console.log('  network restored, tapped "Try again" →', await evaluate(mainText), `· same page load: ${await evaluate('window.__sameLoad === true')} · path ${await evaluate('location.pathname')}`);

console.log('\n3c. learner chunk fails on the first load of Home');
await send('Network.setBlockedURLs', { urls: ['*feature-learner*'] });
await open(BUILT + '/', 390);
await evaluate(`window.__sameLoad = true`);
console.log('  blocked →', await evaluate(mainText));
await send('Network.setBlockedURLs', { urls: [] });
await evaluate(clickText('Go to Home'));
await sleep(2500);
console.log('  network restored, tapped "Go to Home" →', await evaluate(mainText), `· same page load: ${await evaluate('window.__sameLoad === true')}`);

console.log('\n3d. a screen-level chunk of the learner feature (Browse) fails, then "Home" in the header');
await open(BUILT + '/', 390);
await evaluate(`window.__sameLoad = true`);
await send('Network.setBlockedURLs', { urls: ['*Browse-legacy*'] });
await evaluate(pushTo('/portal/primary'));
await sleep(1200);
console.log('  blocked, opened a portal →', await evaluate(mainText));
await send('Network.setBlockedURLs', { urls: [] });
await evaluate(`[...document.querySelectorAll('.sb-shell__bar--nav a')].find((a) => a.textContent.includes('Home')).click()`);
await sleep(2500);
console.log('  network restored, tapped "Home" in the header →', await evaluate(`location.pathname + ' :: ' + ${mainText}`), `· same page load: ${await evaluate('window.__sameLoad === true')}`);
await evaluate(pushTo('/portal/primary'));
await sleep(1500);
console.log('  opened the portal again in-app →', await evaluate(mainText));

ws.close();
chrome.kill();
