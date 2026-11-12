/*
 * Reviewer A, final pass, A-03 residue: a SCREEN chunk (plain React.lazy in a
 * feature's routes file, here the learner's Browse) fails to download, the
 * learner leaves with the phone's own Back button, the network returns, and
 * they tap the same card again.
 *
 *   cd app && npm run build && npx vite preview --port 4199 --strictPort
 *   node docs/reviews/evidence/a03-screen-chunk.mjs > docs/reviews/evidence/a03-screen-chunk.out.txt
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILT = process.env.BUILT_URL ?? 'http://localhost:4199';
const PORT = 9349;
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
let chunkRequests = 0;
let documentLoads = 0;
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
    return;
  }
  if (message.method === 'Network.requestWillBeSent') {
    if (/\/assets\/Browse-/.test(message.params.request.url)) chunkRequests += 1;
    if (message.params.type === 'Document') documentLoads += 1;
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
const MAIN = `location.pathname + ' :: ' + document.querySelector('main').innerText.replace(/\\n+/g, ' | ').slice(0, 110)`;
const tapPortal = `document.querySelector('a.sb-card[href="/portal/agriculture"]').click()`;

await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${BUILT}/` });
await sleep(2000);

await send('Network.setBlockedURLs', { urls: ['*/assets/Browse-*'] });
await evaluate(tapPortal);
await sleep(1500);
console.log('Browse chunk blocked, tapped Agriculture →', await evaluate(MAIN), `(chunk requests so far: ${chunkRequests})`);

await send('Network.setBlockedURLs', { urls: [] });
await evaluate('history.back()');
await sleep(1000);
console.log('network restored, phone Back →', await evaluate(MAIN));

const before = chunkRequests;
const loadsBefore = documentLoads;
await evaluate(tapPortal);
await sleep(1500);
console.log('tapped Agriculture again (network is fine) →', await evaluate(MAIN));
console.log(`  new requests for the chunk: ${chunkRequests - before}; page loads: ${documentLoads - loadsBefore}`);

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Try again')).click()`);
await sleep(2500);
console.log('tapped "Try again" →', await evaluate(MAIN), `(page loads since: ${documentLoads - loadsBefore})`);

ws.close();
chrome.kill();
