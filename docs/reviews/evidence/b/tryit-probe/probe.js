/* External script of the package: what can package code reach when it runs? */
window.__probeScript = true;
window.__ext = { 'external script ran in origin': String(location.origin) };
try { localStorage.setItem('probe.written-by-package', '1'); window.__ext['localStorage of that origin'] = 'READ/WRITE, keys: ' + Object.keys(localStorage).join(', '); } catch (e) { window.__ext['localStorage of that origin'] = 'denied (' + e.name + ')'; }
try {
  var x = new XMLHttpRequest();
  x.open('GET', '/api/v1/portals');
  x.withCredentials = true;
  x.onload = function () { window.__ext['XHR to the bag API with cookies'] = 'ANSWERED ' + x.status + ', ' + x.responseText.length + ' bytes readable'; };
  x.onerror = function () { window.__ext['XHR to the bag API with cookies'] = 'blocked'; };
  x.send();
} catch (e) { window.__ext['XHR to the bag API with cookies'] = 'blocked'; }
