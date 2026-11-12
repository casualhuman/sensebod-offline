/*
 * Reviewer A, final pass: the three features in headless Chrome (production
 * build): horizontal overflow, touch targets under 48px, smallest text, and
 * the Child protection rule (Leave this page, Back, Home, Listen on every
 * such screen).
 *
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reviews/evidence/measure-features.mjs > docs/reviews/evidence/measure-features.out.txt
 *
 * Current desktop Chrome with device emulation only: this says nothing about
 * Chrome 58 or a real phone.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9350;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'sb-review-'))}`, '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
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
  const { result, error } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (error || result.exceptionDetails) throw new Error(JSON.stringify(error ?? result.exceptionDetails));
  return result.result.value;
}
async function open(url, width, height = 740) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 1000 });
  await send('Page.navigate', { url });
  await sleep(1700);
}

const MEASURE = `(() => {
  const vw = window.innerWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('type') || '').trim().replace(/\\s+/g, ' ').slice(0, 36);
  const box = (el) => { // a control inside a label takes the label's box (the label is the target)
    const label = el.closest('label'); const r = (label || el).getBoundingClientRect(); return r; };
  const controls = [...document.querySelectorAll('a[href], button, input, textarea, select, [role=radio], [role=button]')].filter(visible).filter((el) => !el.disabled);
  const small = controls.map((el) => { const r = box(el); return { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().split(' ')[0], name: name(el), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((c) => c.w < 48 || c.h < 48);
  let minFont = 99; let minFontEl = '';
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < minFont) { minFont = size; minFontEl = el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' "' + el.textContent.trim().slice(0, 24) + '"'; }
  }
  const words = (w) => [...document.querySelectorAll('a, button')].filter(visible).some((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().indexOf(w) === 0);
  return { vw, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > vw, controls: controls.length, small, minFont, minFontEl,
    cp: { leave: words('Leave this page'), back: words('Back'), home: words('Home'), listen: words('Listen') || words('No sound') || words('Stop') } };
})()`;

await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');

const seen = new Set();
async function measure(label, url, widths, childProtection = false, before) {
  for (const width of widths) {
    await open(url, width);
    if (before) {
      await evaluate(before);
      await sleep(900);
    }
    const m = await evaluate(MEASURE);
    console.log(`${label} @ ${width}: scrollWidth ${m.scrollWidth}${m.overflowX ? '  ** HORIZONTAL OVERFLOW **' : ''}; controls ${m.controls}; smallest text ${m.minFont}px${m.minFont < 16 ? ' (' + m.minFontEl + ')  ** UNDER 16px **' : ''}`);
    if (childProtection) {
      const missing = Object.keys(m.cp).filter((k) => !m.cp[k]);
      console.log(`    Child protection controls: ${missing.length === 0 ? 'Leave this page, Back, Home, Listen all present' : '** MISSING: ' + missing.join(', ') + ' **'}`);
    }
    for (const s of m.small) {
      const key = `${label}|${s.cls}|${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    small target: <${s.tag}.${s.cls}> "${s.name}" ${s.w}x${s.h}`);
    }
  }
}

const PHONE = [320, 360, 390, 800];
const click = (text) => `(() => { const el = [...document.querySelectorAll('button, a')].find((n) => n.textContent.trim().indexOf('${text}') === 0); if (el) el.click(); })()`;

console.log('## Learner browsing (stream 2)\n');
await measure('Home', `${BUILT}/`, PHONE);
await measure('Save my progress', `${BUILT}/save-progress`, PHONE);
await measure('Primary, class 4', `${BUILT}/portal/primary/primary-class-4`, PHONE);
await measure('Agriculture', `${BUILT}/portal/agriculture`, PHONE);
await measure('Climate', `${BUILT}/portal/climate`, PHONE);
await measure('Child protection: Who are you?', `${BUILT}/portal/child-protection`, PHONE, true);
await measure('Child protection: child lessons', `${BUILT}/portal/child-protection/cp-child/cp-child-staying-safe`, PHONE, true);
await measure('Child protection: elder lessons', `${BUILT}/portal/child-protection/cp-elder`, [320, 390], true);
await measure('Child protection: Get help now', `${BUILT}/portal/child-protection/help`, PHONE, true);
await measure('Child protection: address that is not in the bag', `${BUILT}/portal/child-protection/nowhere`, [390], true);

console.log('\n## Lesson players (stream 3)\n');
await measure('Watch (CP), before Play', `${BUILT}/lesson/cp-child-staying-safe-1`, PHONE, true);
await measure('Watch (CP), playing', `${BUILT}/lesson/cp-child-staying-safe-1`, [320, 390], true, click('Play video'));
await measure('Listen (CP)', `${BUILT}/lesson/cp-child-staying-safe-2`, PHONE, true);
await measure('Try it (CP)', `${BUILT}/lesson/cp-child-staying-safe-3`, PHONE, true);
await measure('Watch and answer (CP), before Play', `${BUILT}/lesson/cp-child-staying-safe-4`, [320, 390], true);
await measure('Check quiz (CP)', `${BUILT}/lesson/cp-child-staying-safe-quiz`, PHONE, true);
await measure('Finished screen (CP), opened directly', `${BUILT}/lesson/cp-child-staying-safe-quiz/done`, [390], true);
await measure('Watch (Agriculture)', `${BUILT}/lesson/agriculture-chickens-and-quail-videos-1`, PHONE);

console.log('\n## Admin (stream 4)\n');
await open(`${BUILT}/admin/sign-in`, 390);
await evaluate(`fetch('/api/v1/admin/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'sensebod' }) }).then((r) => r.status)`);
const ADMIN = [320, 390, 800, 1280];
await measure('Admin home', `${BUILT}/admin`, ADMIN);
await measure('Admin menu', `${BUILT}/admin/menu`, [320, 390]);
await measure('Upload files', `${BUILT}/admin/add/upload`, ADMIN);
await measure('Type it yourself', `${BUILT}/admin/add/type`, ADMIN);
await measure('Photos of notes', `${BUILT}/admin/add/notes`, [320, 390]);
await measure('Where does it go', `${BUILT}/admin/lessons/cp-child-staying-safe-2/place`, ADMIN);
await measure('Choose a picture', `${BUILT}/admin/lessons/cp-child-staying-safe-2/picture`, [320, 390, 1280]);
await measure('Check and publish', `${BUILT}/admin/lessons/cp-child-staying-safe-2/check`, [320, 390]);
await measure('Library', `${BUILT}/admin/library?portalId=child-protection`, ADMIN);
await measure('Series and order', `${BUILT}/admin/series/cp-child-staying-safe`, ADMIN);
await measure('Questions', `${BUILT}/admin/lessons/cp-child-staying-safe-4/questions`, ADMIN);
await measure('Try it setup', `${BUILT}/admin/lessons/cp-child-staying-safe-3/try-it`, ADMIN);

ws.close();
chrome.kill();
