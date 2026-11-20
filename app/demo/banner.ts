/*
 * Online demo only: a small strip at the very top of every page saying this is
 * a demo. It sits outside #root, so React never removes it, and it is in the
 * normal page flow (not fixed), so it never covers the app's own header.
 * The Pi build never includes this file (it is reachable only from demo/main.ts).
 */
const bar = document.createElement('div');
bar.setAttribute('role', 'note');
bar.setAttribute('data-demo-banner', '');
bar.style.cssText = 'margin:0;padding:6px 12px;background:#15233b;color:#ffffff;font:600 13px/1.4 Arial,sans-serif;text-align:center';
bar.textContent = 'Demo — sample data, nothing is saved. Staff sign-in: admin / sensebod';
document.body.insertBefore(bar, document.body.firstChild);
