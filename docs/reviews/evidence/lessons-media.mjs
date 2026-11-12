/*
 * Reviewer A, final pass: lesson player behaviour in a real media engine
 * (headless Chrome, production build). jsdom has no media engine, so the unit
 * tests cannot show these.
 *
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reviews/evidence/lessons-media.mjs > docs/reviews/evidence/lessons-media.out.txt
 *
 * Current desktop Chrome only: this says nothing about Chrome 58 or Android.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9348;
const LESSON = '/lesson/cp-child-staying-safe-1'; // a Watch lesson in Child protection (20 s sample clip)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'sb-review-'))}`, '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'],
  { stdio: 'ignore' },
);

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
const puts = [];
/** When set, requests paused by the Fetch domain are answered with this status. */
let answerWith = null;
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
    return;
  }
  if (message.method === 'Network.requestWillBeSent') {
    const request = message.params.request;
    if (request.method === 'PUT') puts.push(`${request.url.replace(BUILT, '')} ${request.postData ?? ''}`);
  }
  if (message.method === 'Fetch.requestPaused') {
    const id = message.params.requestId;
    if (answerWith) send('Fetch.fulfillRequest', { requestId: id, responseCode: answerWith, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('busy').toString('base64') });
    else send('Fetch.continueRequest', { requestId: id });
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
async function open(url, wait = 1800) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await sleep(wait);
}
const VIDEO = `(() => { const v = document.querySelector('video'); return v ? { currentTime: Math.round(v.currentTime * 10) / 10, paused: v.paused, hasSrc: !!v.getAttribute('src'), error: v.error ? v.error.code : null } : null; })()`;
const PLAYER_WORDS = `(document.querySelector('.les-player') || document.querySelector('main')).innerText.replace(/\\n+/g, ' | ')`;
const clickText = (selector, text) => `(() => { const el = [...document.querySelectorAll('${selector}')].find((n) => n.textContent.trim().indexOf('${text}') === 0); if (!el) return 'NOT FOUND: ${text}'; el.click(); return 'clicked ${text}'; })()`;

await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

/* A learner who saves progress on this phone. */
await open(`${BUILT}/`);
await evaluate(`fetch('/api/v1/learners', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'review-a-' + Date.now() }, body: JSON.stringify({ name: 'Review A', role: 'learner' }) }).then((r) => r.json()).then((learner) => { localStorage.setItem('sensebod.session.v1', JSON.stringify({ learner, knownLearners: [learner], language: 'en', childProtectionAudience: null })); return learner.id; })`);

/* ---- 1. Is the place saved when the learner leaves a video that is playing? ---- */
console.log('## 1. Position saved on pause, and on leaving while playing (A-17)\n');
await open(`${BUILT}${LESSON}`);
puts.length = 0;
console.log(await evaluate(clickText('button', 'Play video')));
await sleep(4000);
console.log('playing for 4 s:', JSON.stringify(await evaluate(VIDEO)));
console.log(await evaluate(clickText('button', 'Pause')));
await sleep(800);
console.log('control, PUTs after Pause:', JSON.stringify(puts));

await open(`${BUILT}${LESSON}`);
puts.length = 0;
console.log(await evaluate(clickText('button', 'Play video')));
await sleep(7000);
console.log('playing again, not paused:', JSON.stringify(await evaluate(VIDEO)));
puts.length = 0;
console.log(await evaluate(clickText('a', 'Back')));
await sleep(1500);
console.log('now at:', await evaluate('location.pathname'));
console.log('PUTs after leaving with Back while playing:', JSON.stringify(puts), puts.some((p) => p.includes('positionSeconds')) ? '' : '  ** NO POSITION SAVED **');

/* ---- 2. The video file does not arrive when Play is tapped ---- */
console.log('\n## 2. The video file does not arrive when Play is tapped (A-16)\n');
await send('Network.setBlockedURLs', { urls: ['*sample-video.mp4*'] });
await open(`${BUILT}${LESSON}`);
console.log(await evaluate(clickText('button', 'Play video')));
await sleep(2500);
console.log('connection to the file fails (Wi-Fi dropped) → video:', JSON.stringify(await evaluate(VIDEO)));
console.log('  the learner is told:', await evaluate(PLAYER_WORDS));
console.log('  a "Try again" button is offered:', await evaluate(`[...document.querySelectorAll('.les-player button')].some((b) => b.textContent.includes('Try again'))`));
await send('Network.setBlockedURLs', { urls: [] });

await send('Fetch.enable', { patterns: [{ urlPattern: '*sample-video.mp4*' }] });
answerWith = 503;
await open(`${BUILT}${LESSON}`);
console.log(await evaluate(clickText('button', 'Play video')));
await sleep(2500);
console.log('the bag answers 503 (busy, or its media rate limit) → video:', JSON.stringify(await evaluate(VIDEO)));
console.log('  the learner is told:', await evaluate(PLAYER_WORDS));
console.log('  a "Try again" button is offered:', await evaluate(`[...document.querySelectorAll('.les-player button')].some((b) => b.textContent.includes('Try again'))`));
answerWith = null;
await send('Fetch.disable');

/* ---- 3. Child protection lesson: quick exit while loading and after a failed load ---- */
console.log('\n## 3. "Leave this page" on a Child protection lesson that is loading or failed (A-18)\n');
const LEAVE = `JSON.stringify({ leaveThisPage: [...document.querySelectorAll('a, button')].some((n) => n.textContent.includes('Leave this page')), main: document.querySelector('main').innerText.replace(/\\n+/g, ' | ').slice(0, 120) })`;
await open(`${BUILT}${LESSON}`);
console.log('loaded:', await evaluate(LEAVE));
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/lessons/*' }] });
answerWith = 503;
await open(`${BUILT}${LESSON}`);
console.log('lesson request answered 503:', await evaluate(LEAVE));
await open(`${BUILT}${LESSON}/done`);
console.log('finished screen, lesson request answered 503:', await evaluate(LEAVE));
answerWith = null;
await send('Fetch.disable');

ws.close();
chrome.kill();
