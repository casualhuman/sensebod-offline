#!/usr/bin/env node
/*
 * `npm run size` (after `npm run build`): raw and gzip sizes of what a device
 * downloads, against the budgets in docs/ARCHITECTURE.md. Exits 1 if a budget
 * is exceeded. Add `--json` for machine-readable output.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const KB = 1024;
const BUDGET = {
  /** gzip, the scripts every first visit needs (polyfills + entry). */
  startJs: 200 * KB,
  /** gzip (fonts as-is), everything needed to show the first screen. */
  critical: 350 * KB,
  /** gzip, any single lazy feature chunk. */
  featureChunk: 60 * KB,
};

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (!entry.name.endsWith('.gz')) out.push(full);
  }
  return out;
}

async function measure(file) {
  const raw = await fs.readFile(file);
  const compressible = /\.(html|js|css|svg|json)$/.test(file);
  return { file: path.relative(dist, file), raw: raw.length, gzip: compressible ? gzipSync(raw, { level: 9 }).length : raw.length };
}

const all = await Promise.all((await walk(dist)).map(measure));
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const startScripts = [...html.matchAll(/(?:src|data-src)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const preloadedFonts = [...html.matchAll(/href="\/(assets\/[^"]+\.woff2)"/g)].map((m) => m[1]);

const pick = (test) => all.filter((f) => test(f.file));
const sum = (list, key) => list.reduce((total, f) => total + f[key], 0);
const groups = {
  'index.html': pick((f) => f === 'index.html'),
  'JS · start (polyfills + entry)': pick((f) => startScripts.includes(f)),
  'JS · lazy chunks (all features)': pick((f) => f.startsWith('assets/') && f.endsWith('.js') && !startScripts.includes(f)),
  'CSS files': pick((f) => f.endsWith('.css')),
  'Fonts · preloaded (Poppins 400, 800)': pick((f) => preloadedFonts.includes(f)),
  'Fonts · on demand (600, 700, Krio letters)': pick((f) => f.endsWith('.woff2') && !preloadedFonts.includes(f)),
  'Brand images + favicon': pick((f) => f.startsWith('brand/') || f.startsWith('favicon')),
  'Portal pictures (Home)': pick((f) => f.startsWith('pictures/')),
  'Illustrations (loaded one by one, lazily)': pick((f) => f.startsWith('illustrations/')),
};

const startJs = sum(groups['JS · start (polyfills + entry)'], 'gzip');
const critical =
  sum(groups['index.html'], 'gzip') + startJs + sum(groups['CSS files'], 'gzip') + sum(groups['Fonts · preloaded (Poppins 400, 800)'], 'gzip') + sum(pick((f) => f === 'brand/sensebod-logo.png'), 'gzip');
const largestLazy = groups['JS · lazy chunks (all features)'].reduce((max, f) => (f.gzip > max.gzip ? f : max), { file: '-', gzip: 0 });
const checks = [
  { name: 'Start JavaScript (gzip)', value: startJs, budget: BUDGET.startJs },
  { name: 'Critical resources for first screen (gzip): html + start JS + CSS + 2 fonts + logo', value: critical, budget: BUDGET.critical },
  { name: `Largest lazy chunk (gzip): ${largestLazy.file}`, value: largestLazy.gzip, budget: BUDGET.featureChunk },
];

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { files: v.length, raw: sum(v, 'raw'), gzip: sum(v, 'gzip') }])), checks }, null, 2));
} else {
  const kb = (n) => (n / KB).toFixed(1).padStart(8) + ' KB';
  console.log('\nBuilt sizes (dist/)\n');
  console.log('group'.padEnd(46) + 'files'.padStart(6) + 'raw'.padStart(12) + 'gzip'.padStart(12));
  for (const [name, list] of Object.entries(groups)) {
    console.log(name.padEnd(46) + String(list.length).padStart(6) + kb(sum(list, 'raw')) + ' ' + kb(sum(list, 'gzip')));
  }
  console.log('\nJavaScript and CSS files');
  for (const f of all.filter((x) => /\.(js|css)$/.test(x.file)).sort((a, b) => b.gzip - a.gzip)) console.log('  ' + f.file.padEnd(48) + kb(f.raw) + ' ' + kb(f.gzip));
  console.log('\nBudgets');
  for (const c of checks) console.log(`  ${c.value <= c.budget ? 'ok  ' : 'OVER'} ${kb(c.value)} of ${kb(c.budget)}  ${c.name}`);
  console.log('');
}
process.exit(checks.every((c) => c.value <= c.budget) ? 0 : 1);
