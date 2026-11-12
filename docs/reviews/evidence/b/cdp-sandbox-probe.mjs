/*
 * Reviewer B: what an uploaded animation package can and cannot do under the
 * /media/tryit/ response headers of the deployment config.
 *   node cdp-sandbox-probe.mjs http://127.0.0.1:48080
 * Needs the media folder made by make-probe-media.mjs mounted as /media/.
 */
import { connectPage, enableAll, launchChrome, sleep, waitFor } from './cdp-lib.mjs';

const BASE = process.argv[2];
const chrome = await launchChrome({ port: Number(process.env.CDP_PORT || 49224) });
const print = (title, r) => { console.log('\n' + title); for (const [k, v] of Object.entries(r)) console.log('  ' + k.padEnd(48) + (Array.isArray(v) ? '\n      ' + v.join('\n      ') : v)); };
try {
  console.log('browser: ' + chrome.info.Browser + '   server: ' + BASE);
  // 1. the package opened directly (someone follows or types its URL)
  let page = await connectPage(chrome.port);
  await enableAll(page);
  await page.send('Page.navigate', { url: BASE + '/media/tryit/probe/index.html' });
  await sleep(3000);
  const read = 'JSON.stringify(Object.assign({}, window.__ext || { "external script (probe.js)": "did not run" }, window.__probe || { "inline script": "DID NOT RUN (blocked)" }))';
    console.log('Content-Security-Policy on the package response, as the browser received it: ' + (await (await fetch(BASE + '/media/tryit/probe/index.html')).headers.get('content-security-policy')));
  print('A. package opened as a top-level page (/media/tryit/probe/index.html)', JSON.parse(await page.evaluate(read)));
  await page.close();

  // 2. inside the app, the way ARCHITECTURE section 12 says stream 3 should show it
  page = await connectPage(chrome.port);
  await enableAll(page);
  await page.send('Page.navigate', { url: BASE + '/' });
  await waitFor(page, `!!document.querySelector('.sb-grid a')`);
  const frameResult = async (query) => {
    await page.evaluate(`(() => { const f = document.createElement('iframe'); ${query ? '' : "f.setAttribute('sandbox', 'allow-scripts');"} f.id = 'probe${query}'; f.src = '/media/tryit/probe/index.html${query}'; document.body.appendChild(f); return true; })()`);
    await sleep(3500);
    // the frame is a separate (out-of-process) target; read its results there
    const frame = await connectPage(chrome.port, { match: (t) => t.type === 'iframe' && t.url.endsWith('index.html' + query) }).catch(() => null);
    if (frame) return JSON.parse(await frame.evaluate(read));
    // no separate target: the frame is same-origin with the app page, which can simply reach into it
    const w = `document.getElementById('probe${query}').contentWindow`;
    return { 'SAME ORIGIN AS THE APP': 'the app page reads the frame directly', ...JSON.parse(await page.evaluate(`JSON.stringify(Object.assign({}, ${w}.__ext || {}, ${w}.__probe || { "inline script": "DID NOT RUN (blocked)" }))`)) };
  };
  await page.evaluate(`localStorage.setItem('sensebod.session.v1', JSON.stringify({ learner: { id: 'learner-aminata', name: 'Aminata' } })); true`);
  print('B. package inside <iframe sandbox="allow-scripts"> on the app page', await frameResult(''));
  console.log('\n  app page can read the frame document: ' + (await page.evaluate(`(() => { try { return !!document.getElementById('probe').contentDocument; } catch (e) { return 'no (' + e.name + ')'; } })()`)));

  // 3. the same frame WITHOUT the sandbox attribute: is the response header alone enough?
  const r2 = await frameResult('?plain');
  print('C. frame WITHOUT the sandbox attribute (only the response header protects the app)', r2);
  await page.close();
} finally {
  chrome.close();
}
