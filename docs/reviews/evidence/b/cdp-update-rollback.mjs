/*
 * Reviewer B: what a phone with an open tab sees across "update, then roll back"
 * (docs/ARCHITECTURE.md section 12), served by app/deploy/nginx.conf unchanged.
 *
 *   www/releases/A   = app/dist
 *   www/releases/B   = app/dist without the feature-lessons chunk (stands for "a newer build":
 *                      a newer build has different chunk names, so A's lazy chunks do not exist in it)
 *   www/current      -> releases/A        (nginx root is /var/www/sensebod/current)
 *
 *   node cdp-update-rollback.mjs http://127.0.0.1:48082 /path/to/www
 */
import { renameSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { connectPage, enableAll, launchChrome, recordNetwork, sleep, waitFor } from './cdp-lib.mjs';

const [BASE, WWW] = process.argv.slice(2);
const point = (release) => { symlinkSync('releases/' + release, path.join(WWW, 'current.new')); renameSync(path.join(WWW, 'current.new'), path.join(WWW, 'current')); };
const chrome = await launchChrome({ port: Number(process.env.CDP_PORT || 49223) });
const page = await connectPage(chrome.port);
await enableAll(page);
const log = recordNetwork(page);
const chunk = () => [...log.requests.values()].filter((r) => /feature-lessons/.test(r.url)).map((r) => `${r.status}${r.fromCache ? ' (from the browser cache)' : ' (network)'} cache-control: ${r.cacheControl}`);
const screen = () => page.evaluate(`document.title + ' | ' + ((document.querySelector('#sb-main h1, #sb-main h2, #sb-main [role=alert]') || {}).textContent || '').slice(0, 80)`);
const goLesson = `history.pushState(null, '', '/lesson/cp-child-staying-safe-1'); dispatchEvent(new PopStateEvent('popstate'))`;
try {
  point('A');
  console.log('browser: ' + chrome.info.Browser);
  await page.send('Page.navigate', { url: BASE + '/' });
  await waitFor(page, `!!document.querySelector('.sb-grid a')`);
  console.log('1. release A live, phone opens Home:            ' + (await screen()));

  point('B');
  await page.evaluate(goLesson);
  await sleep(1500);
  console.log('2. release B goes live; the open tab taps a lesson: ' + (await screen()));
  console.log('   feature-lessons chunk requests so far: ' + JSON.stringify(chunk()));

  point('A');
  log.requests.clear();
  await page.send('Page.reload');
  await sleep(2500);
  console.log('3. rollback to A; "Try again" (reload) on the phone: ' + (await screen()));
  console.log('   feature-lessons chunk requests: ' + JSON.stringify(chunk()));

  log.requests.clear();
  await page.send('Page.navigate', { url: BASE + '/' });
  await waitFor(page, `!!document.querySelector('.sb-grid a')`);
  await page.evaluate(goLesson);
  await sleep(1500);
  console.log('4. fresh visit to Home, then a lesson:            ' + (await screen()));
  console.log('   feature-lessons chunk requests: ' + JSON.stringify(chunk()));

  log.requests.clear();
  await page.send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  console.log('5. hard reload (not available in Android Chrome UI): ' + (await screen()));
  console.log('   feature-lessons chunk requests: ' + JSON.stringify(chunk()));
  const direct = await page.evaluate(`fetch('/assets/' + ${JSON.stringify('')} + performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /feature-lessons/.test(n))[0].split('/assets/')[1]).then((r) => r.status)`).catch((e) => String(e));
  console.log('   fetch() of the chunk afterwards: ' + direct);
} finally {
  point('A');
  await page.close();
  chrome.close();
}
