/*
 * Reviewer B: scripted walk through the served production build, logging every request per step.
 *   node cdp-walk.mjs <base url> <step> [<step> ...]
 * Steps:
 *   goto:/path            full page load (cold cache on the first one)
 *   push:/path            in-app navigation (history.pushState + popstate)
 *   click:Text            click the first visible button / link / label whose text or aria-label contains Text
 *   clicksel:css          click the first element matching the selector
 *   type:css=value        (split at the last '=') type into an input / textarea (React-controlled safe)
 *   file:css=/abs/path    choose a file in an <input type=file>
 *   wait:ms               wait
 *   width:px              viewport width (default 390)
 *   dump                  print headings, buttons, links, inputs, media elements
 *   media                 print state of <video>/<audio>/<iframe> elements
 *   heap                  force GC and print JS heap, DOM nodes, listeners
 *   eval:js               evaluate and print
 *   throttle:kbps         network throttle (0 = off)
 *   offline:on|off
 * After every step: the requests made during the step (status, bytes on the wire, range), and
 * any request to another origin, console error, exception or CSP violation.
 * Chrome is started with DNS that only resolves loopback, so a request to the internet fails and is listed.
 */
import { connectPage, enableAll, launchChrome, sleep } from './cdp-lib.mjs';

const [BASE, ...steps] = process.argv.slice(2);
const origin = new URL(BASE).origin;
const chrome = await launchChrome({ port: Number(process.env.CDP_PORT || 49230), binary: process.env.CHROME_BIN || undefined });
const page = await connectPage(chrome.port);
await enableAll(page);
await page.send('Performance.enable');
await page.send('HeapProfiler.enable').catch(() => {});

const reqs = new Map();
let notes = [];
let total = 0;
let external = 0;
page.on('Network.requestWillBeSent', (p) => {
  if (p.request.url.startsWith('data:') || p.request.url.startsWith('about:')) return;
  reqs.set(p.requestId, { url: p.request.url, method: p.request.method, range: p.request.headers.Range || p.request.headers.range || '', type: p.type, hasBody: !!p.request.hasPostData, idem: p.request.headers['Idempotency-Key'] || '' });
});
page.on('Network.responseReceived', (p) => { const r = reqs.get(p.requestId); if (r) { r.status = p.response.status; r.cache = !!p.response.fromDiskCache; r.type = p.type || r.type; r.cr = (p.response.headers['Content-Range'] || p.response.headers['content-range'] || ''); r.enc = p.response.headers['Content-Encoding'] || p.response.headers['content-encoding'] || ''; } });
page.on('Network.requestServedFromCache', (p) => { const r = reqs.get(p.requestId); if (r) r.cache = true; });
page.on('Network.loadingFinished', (p) => { const r = reqs.get(p.requestId); if (r) { r.bytes = p.encodedDataLength; r.done = true; } });
page.on('Network.loadingFailed', (p) => { const r = reqs.get(p.requestId); if (r) { r.failed = p.errorText + (p.canceled ? ' (cancelled)' : ''); r.done = true; } });
page.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'warning') notes.push('console.' + p.type + ': ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
page.on('Runtime.exceptionThrown', (p) => notes.push('EXCEPTION: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 400)));
page.on('Log.entryAdded', (p) => { if (p.entry.level === 'error' || p.entry.source === 'security') notes.push('browser ' + p.entry.source + ': ' + p.entry.text.slice(0, 300) + (p.entry.url ? ' [' + p.entry.url.replace(origin, '') + ']' : '')); });

const PROBE = `window.__rb = { long: [], csp: [] };
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__rb.long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
document.addEventListener('securitypolicyviolation', (e) => { window.__rb.csp.push(e.violatedDirective + ' <- ' + (e.blockedURI || 'inline')); });`;
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
let width = 390;
await page.send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 2, mobile: true });
await page.send('Network.clearBrowserCache');
await page.send('Network.clearBrowserCookies');

async function settle() {
  let last = -1;
  for (let i = 0; i < 50; i += 1) {
    await sleep(300);
    const open = [...reqs.values()].filter((r) => !r.done && r.type !== 'Media').length;
    if (reqs.size === last && open === 0) return;
    last = reqs.size;
  }
}
const FIND = (text) => `(() => {
  const want = ${JSON.stringify(text)}.toLowerCase();
  const all = [...document.querySelectorAll('button, a, label, [role=button], [role=radio], input[type=submit], summary')];
  const vis = all.filter((e) => e.getClientRects().length && !e.disabled);
  const name = (e) => ((e.getAttribute('aria-label') || '') + ' ' + e.textContent).replace(/\\s+/g, ' ').trim().toLowerCase();
  const el = vis.find((e) => name(e) === want) || vis.find((e) => name(e).indexOf(want) >= 0);
  if (!el) return 'NOT FOUND: ' + ${JSON.stringify(text)};
  el.scrollIntoView({ block: 'center' }); el.click(); return 'clicked <' + el.tagName.toLowerCase() + '> "' + name(el).slice(0, 60) + '"';
})()`;
const DUMP = `(() => {
  const t = (e) => ((e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + '] ' : '') + e.textContent).replace(/\\s+/g, ' ').trim().slice(0, 70);
  const vis = (s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length);
  return JSON.stringify({ path: location.pathname + location.search, title: document.title,
    h: vis('h1,h2').map(t).slice(0, 8), alerts: vis('[role=alert],[role=status]').map(t).slice(0, 4),
    buttons: vis('button').map((b) => t(b) + (b.disabled ? ' (disabled)' : '')).slice(0, 40), links: vis('a').map((a) => t(a) + ' -> ' + a.getAttribute('href')).slice(0, 40),
    inputs: vis('input,textarea,select').map((i) => i.tagName.toLowerCase() + '[' + (i.type || '') + '] name=' + i.name + ' id=' + i.id + ' accept=' + (i.accept || '') + (i.hasAttribute('capture') ? ' capture' : '') + (i.multiple ? ' multiple' : '')),
    hiddenFileInputs: [...document.querySelectorAll('input[type=file]')].map((i) => 'id=' + i.id + ' accept=' + i.accept + (i.hasAttribute('capture') ? ' capture=' + i.getAttribute('capture') : '') + (i.multiple ? ' multiple' : '')),
    imgs: document.images.length, imgsLoaded: [...document.images].filter((i) => i.complete && i.naturalWidth).length, dom: document.getElementsByTagName('*').length });
})()`;
const MEDIA = `JSON.stringify({ media: [...document.querySelectorAll('video,audio')].map((m) => ({ tag: m.tagName, src: m.getAttribute('src'), currentSrc: m.currentSrc.replace(location.origin, ''), preload: m.getAttribute('preload'), autoplay: m.autoplay, paused: m.paused, t: Math.round(m.currentTime * 10) / 10, dur: m.duration, ready: m.readyState, net: m.networkState, tracks: m.querySelectorAll('track').length, sources: m.querySelectorAll('source').length, buffered: m.buffered.length ? Math.round(m.buffered.end(m.buffered.length - 1) * 10) / 10 : 0, playsinline: m.hasAttribute('playsinline') })),
  iframes: [...document.querySelectorAll('iframe')].map((f) => ({ src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow') })) })`;

function report(label) {
  const list = [...reqs.values()];
  total += list.length;
  const ext = list.filter((r) => !r.url.startsWith(origin));
  external += ext.length;
  const bytes = list.reduce((n, r) => n + (r.cache ? 0 : r.bytes || 0), 0);
  console.log(`\n## ${label}   requests: ${list.length} (${list.filter((r) => r.cache).length} from cache), ${(bytes / 1024).toFixed(1)} KB on the wire, other origins: ${ext.length}`);
  for (const r of list) console.log(`     ${(r.failed ? 'ERR' : String(r.status ?? '...')).padEnd(4)} ${r.method.padEnd(5)} ${(r.cache ? 'cache' : String(Math.round(r.bytes || 0)) + 'B').padStart(8)} ${(r.type || '').padEnd(10)} ${r.url.replace(origin, '')}${r.range ? '   [Range: ' + r.range + ' -> ' + (r.cr || 'no Content-Range') + ']' : ''}${r.idem ? '   [Idempotency-Key: ' + r.idem.slice(0, 13) + '…]' : ''}${r.hasBody ? '   [body]' : ''}${r.failed ? '   ' + r.failed : ''}`);
  for (const n of notes) console.log('     ! ' + n);
  reqs.clear();
  notes = [];
}

try {
  console.log('browser: ' + chrome.info.Browser + '   base: ' + BASE);
  for (const step of steps) {
    const at = step.indexOf(':');
    const kind = at < 0 ? step : step.slice(0, at);
    const arg = at < 0 ? '' : step.slice(at + 1);
    let out = '';
    if (kind === 'goto') { await page.send('Page.navigate', { url: BASE + arg }); await sleep(400); }
    else if (kind === 'push') await page.evaluate(`history.pushState(null, '', ${JSON.stringify(arg)}); dispatchEvent(new PopStateEvent('popstate')); true`);
    else if (kind === 'click') out = await page.evaluate(FIND(arg));
    else if (kind === 'tap') {
      // real mouse events at the element's position: a user gesture, which media play() needs
      const pos = JSON.parse(await page.evaluate(`(() => {
        const want = ${JSON.stringify(arg)}.toLowerCase();
        const vis = [...document.querySelectorAll('button, a, label, [role=button], [role=radio], summary')].filter((e) => e.getClientRects().length && !e.disabled);
        const name = (e) => ((e.getAttribute('aria-label') || '') + ' ' + e.textContent).replace(/\\s+/g, ' ').trim().toLowerCase();
        const el = vis.find((e) => name(e) === want) || vis.find((e) => name(e).indexOf(want) >= 0);
        if (!el) return JSON.stringify({ missing: true });
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, name: name(el).slice(0, 60) });
      })()`));
      if (pos.missing) out = 'NOT FOUND: ' + arg;
      else {
        await sleep(250);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
        out = 'tapped "' + pos.name + '"';
      }
    }
    else if (kind === 'clicksel') out = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(arg)}); if (!e) return 'NOT FOUND'; e.click(); return 'clicked'; })()`);
    else if (kind === 'type') { const eq = arg.lastIndexOf('='); out = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(arg.slice(0, eq))}); if (!e) return 'NOT FOUND'; const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(arg.slice(eq + 1))}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 'typed'; })()`); }
    else if (kind === 'file') { const eq = arg.lastIndexOf('='); const doc = await page.send('DOM.getDocument'); const node = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: arg.slice(0, eq) }); if (!node.nodeId) out = 'NOT FOUND'; else { await page.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: arg.slice(eq + 1).split(',') }); out = 'file chosen'; } }
    else if (kind === 'wait') await sleep(Number(arg));
    else if (kind === 'width') { width = Number(arg); await page.send('Emulation.setDeviceMetricsOverride', { width, height: width > 1000 ? 900 : width > 700 ? 1100 : 760, deviceScaleFactor: 2, mobile: width < 1000 }); }
    else if (kind === 'dump') out = await page.evaluate(DUMP);
    else if (kind === 'media') out = await page.evaluate(MEDIA);
    else if (kind === 'eval') out = JSON.stringify(await page.evaluate(arg));
    else if (kind === 'throttle') await page.send('Network.emulateNetworkConditions', { offline: false, latency: Number(arg) ? 40 : 0, downloadThroughput: Number(arg) ? (Number(arg) * 1000) / 8 : -1, uploadThroughput: Number(arg) ? (Number(arg) * 1000) / 8 : -1 });
    else if (kind === 'offline') await page.send('Network.emulateNetworkConditions', { offline: arg === 'on', latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    else if (kind === 'heap') {
      for (let i = 0; i < 3; i += 1) { await page.send('HeapProfiler.collectGarbage'); await sleep(150); }
      const m = Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      out = `heap ${(m.JSHeapUsedSize / 1048576).toFixed(2)} MB, DOM nodes ${m.Nodes}, listeners ${m.JSEventListeners}, documents ${m.Documents}, frames ${m.Frames}`;
    }
    if (!['dump', 'media', 'heap', 'eval', 'wait', 'width'].includes(kind)) await settle();
    const state = await page.evaluate(`JSON.stringify({ p: location.pathname + location.search, t: document.title, h1: (document.querySelector('#sb-main h1, h1') || {}).textContent || '', long: window.__rb ? window.__rb.long.splice(0) : [], csp: window.__rb ? window.__rb.csp.splice(0) : [] })`).then(JSON.parse).catch(() => ({}));
    if (state.csp && state.csp.length) notes.push('CSP VIOLATION: ' + state.csp.join(' | '));
    report(`${step}${out && out.length < 90 ? '  → ' + out : ''}   [${state.p} · "${state.h1}"${state.long && state.long.length ? ' · long tasks ' + state.long.join(',') + ' ms' : ''}]`);
    if (out && out.length >= 90) console.log('     ' + out);
  }
  console.log(`\nTOTAL requests: ${total}   to another origin: ${external}`);
} finally {
  await page.close().catch(() => {});
  chrome.close();
}
