/*
 * Reviewer B: memory, DOM nodes and listeners over repeated in-app navigation.
 *   node cdp-memory.mjs http://127.0.0.1:48080
 * One cycle = Home → a lesson (a different one of 60 each time, so the 40-entry API cache
 * turns over) → admin → an unknown URL → Home. Garbage is collected before each reading.
 * Desktop Chrome on a Mac: shows whether anything accumulates, not what a phone can hold.
 */
import { connectPage, enableAll, launchChrome, recordNetwork, sleep, waitFor } from './cdp-lib.mjs';

const BASE = process.argv[2];
const chrome = await launchChrome({ port: Number(process.env.CDP_PORT || 49227) });
const page = await connectPage(chrome.port);
await enableAll(page);
const log = recordNetwork(page);
await page.send('Performance.enable');
await page.send('HeapProfiler.enable');
const reading = async (label) => {
  for (let i = 0; i < 3; i += 1) { await page.send('HeapProfiler.collectGarbage'); await sleep(150); }
  const m = Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const timers = await page.evaluate('JSON.stringify(window.__t)');
  console.log(`${label.padEnd(22)} heap ${(m.JSHeapUsedSize / 1048576).toFixed(2).padStart(6)} MB   DOM nodes ${String(m.Nodes).padStart(5)}   listeners ${String(m.JSEventListeners).padStart(4)}   documents ${m.Documents}   requests so far ${String(log.requests.size).padStart(4)}   timers ${timers}`);
  return m;
};
try {
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__t = { set: 0, cleared: 0, interval: 0 }; (() => { const s = setTimeout, c = clearTimeout, i = setInterval; window.setTimeout = function () { window.__t.set += 1; return s.apply(this, arguments); }; window.clearTimeout = function () { window.__t.cleared += 1; return c.apply(this, arguments); }; window.setInterval = function () { window.__t.interval += 1; return i.apply(this, arguments); }; })();` });
  await page.send('Page.navigate', { url: BASE + '/' });
  await waitFor(page, `!!document.querySelector('.sb-grid a')`);
  console.log('browser: ' + chrome.info.Browser);
  // Paced: Chrome ignores history.pushState beyond 200 calls per 10 s (its own flood protection),
  // which stalled an earlier unpaced version of this script at cycle 50. Not an app problem.
  const go = (p) => `new Promise((r) => setTimeout(r, 70)).then(() => { history.pushState(null, '', ${JSON.stringify(p)}); dispatchEvent(new PopStateEvent('popstate')); })`;
  const lessons = [];
  for (let n = 1; n <= 12; n += 1) lessons.push('agriculture-chickens-and-quail-videos-' + n);
  for (let n = 1; n <= 27; n += 1) lessons.push('agriculture-feed-and-animal-health-videos-' + n);
  for (let n = 1; n <= 7; n += 1) lessons.push('agriculture-rabbits-videos-' + n);
  for (let n = 1; n <= 4; n += 1) lessons.push('cp-child-staying-safe-' + n);
  for (let n = 1; n <= 10; n += 1) lessons.push('agriculture-milk-and-dairy-cows-videos-' + n);
  const cycle = async (i) => {
    await page.evaluate(go('/lesson/' + lessons[i % lessons.length]));
    await waitFor(page, `document.title.indexOf('Home') !== 0 && !!document.querySelector('#sb-main h1, #sb-main [role=alert]')`, 20000).catch(async (e) => {
      console.log('STUCK at cycle ' + i + ' on ' + lessons[i % lessons.length] + ': ' + (await page.evaluate(`document.title + ' | ' + location.pathname + ' | ' + document.getElementById('root').textContent.slice(0, 200)`)));
      console.log('  open requests: ' + JSON.stringify([...log.requests.values()].filter((r) => !r.end && !r.failed).map((r) => r.url)) + '  last: ' + JSON.stringify([...log.requests.values()].slice(-3).map((r) => r.status + ' ' + r.failed + ' ' + r.url)));
      throw e;
    });
    await page.evaluate(go('/admin'));
    await waitFor(page, `document.title.indexOf('Admin') === 0`, 8000);
    await page.evaluate(go('/not/a/page/' + i));
    await waitFor(page, `document.title.indexOf('Page not found') === 0`, 8000);
    await page.evaluate(go('/'));
    await waitFor(page, `document.title.indexOf('Home') === 0 && !!document.querySelector('.sb-grid a')`, 8000);
  };
  for (let i = 0; i < 5; i += 1) await cycle(i); // warm up: every chunk loaded
  const first = await reading('after 5 cycles');
  let done = 5;
  let last = first;
  for (const target of [50, 100, 200, 300]) {
    for (; done < target; done += 1) await cycle(done);
    last = await reading('after ' + target + ' cycles');
  }
  console.log(`\ngrowth from cycle 5 to cycle 300 (1180 screen changes): heap ${((last.JSHeapUsedSize - first.JSHeapUsedSize) / 1024).toFixed(0)} KB, DOM nodes ${last.Nodes - first.Nodes}, listeners ${last.JSEventListeners - first.JSEventListeners}`);
  console.log('exceptions: ' + log.exceptions.length + '   failed requests: ' + [...log.requests.values()].filter((r) => r.failed).length + '   API requests: ' + [...log.requests.values()].filter((r) => r.url.includes('/api/')).length);
} finally {
  await page.close();
  chrome.close();
}
