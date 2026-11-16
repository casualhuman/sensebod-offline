#!/usr/bin/env node
/*
 * Runs after `vite build` (see package.json "build"). It
 *  1. adds <link rel="preload"> for the entry chunk, so it downloads while
 *     the polyfills run instead of after them;
 *  2. checks the inline script in index.html against the hash allowed by the
 *     CSP in deploy/nginx.conf and deploy/Caddyfile (fails the build if the
 *     build tool ever changes that snippet);
 *  3. checks the output for anything that would need the internet;
 *  4. checks that development-only code did not get in;
 *  5. writes .gz files next to every text asset, so the Pi serves them with
 *     gzip_static and never spends CPU compressing.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const appDir = path.resolve(import.meta.dirname, '..');
const dist = path.join(appDir, 'dist');
const problems = [];

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/* 1. preload the entry chunk */
const htmlPath = path.join(dist, 'index.html');
let html = await fs.readFile(htmlPath, 'utf8');
const polyfills = /<script[^>]*id="vite-legacy-polyfill"[^>]*src="([^"]+)"/.exec(html)?.[1];
const entry = /<script[^>]*id="vite-legacy-entry"[^>]*data-src="([^"]+)"/.exec(html)?.[1];
if (!polyfills || !entry) {
  problems.push('index.html: could not find the polyfill and entry scripts (did the build setup change?)');
} else if (!html.includes('rel="preload" href="' + entry)) {
  // No crossorigin attribute: SystemJS loads the entry with a plain <script>,
  // and a preload is only reused when the credentials mode matches.
  html = html.replace('</head>', `    <link rel="preload" href="${entry}" as="script" />\n  </head>`);
  await fs.writeFile(htmlPath, html);
}

/* 2. inline scripts must match the CSP hashes in the deployment configs */
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((code) => code.trim());
const hashes = inline.map((code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
for (const config of ['deploy/nginx.conf', 'deploy/Caddyfile']) {
  let text = '';
  try {
    text = await fs.readFile(path.join(appDir, config), 'utf8');
  } catch {
    problems.push(`${config} is missing`);
    continue;
  }
  for (const hash of hashes) {
    if (!text.includes(hash)) problems.push(`${config}: CSP script-src is missing ${hash} for an inline script in index.html`);
  }
}

/* 3. nothing may point at the internet */
// Strings that look like URLs but are never requested: XML namespaces, and
// links inside library error/warning texts.
const HARMLESS = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/reactjs\.org\//, /^https?:\/\/react\.dev\//, /^https?:\/\/github\.com\//, /^https?:\/\/fb\.me\//, /^https?:\/\/mths\.be\//, /^https?:\/\/sensebod\.test/];
const files = await walk(dist);
const textFiles = files.filter((file) => /\.(html|js|css|svg|json|txt|vtt)$/.test(file));
const external = new Map();
for (const file of textFiles) {
  // Games are other projects' code, kept as written: their comments and licence headers name web
  // addresses. Each game is checked for real network use when it is installed (docs/GAMES.md),
  // not by this scan of the app's own output.
  if (path.relative(dist, file).split(path.sep)[0] === 'games') continue;
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)<>\\]*/gi)) {
    const url = match[0];
    if (!/^https?:/.test(url)) {
      // protocol-relative: only real if it sits in a URL position
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      if (!/(src|href|url\()\s*=?\s*["'(]?$/.test(before)) continue;
    }
    if (HARMLESS.some((pattern) => pattern.test(url))) continue;
    const rel = path.relative(dist, file);
    external.set(`${rel}: ${url}`, true);
  }
}
for (const hit of external.keys()) problems.push(`external URL in build output → ${hit}`);

/* 4. development-only code must not ship */
const scripts = files.filter((file) => file.endsWith('.js'));
for (const file of scripts) {
  const text = await fs.readFile(file, 'utf8');
  for (const marker of ['Kitchen sink', '__dev', 'mock-session', '__mock/', 'sample-video.mp4']) {
    if (text.includes(marker)) problems.push(`development-only code in ${path.relative(dist, file)} (found "${marker}")`);
  }
}
if (files.some((file) => /[\\/]media[\\/]/.test(path.relative(dist, file)))) problems.push('mock media was copied into dist/');

/* 5. pre-compress */
let saved = 0;
let count = 0;
for (const file of textFiles) {
  const raw = await fs.readFile(file);
  if (raw.length < 512) continue;
  const gz = gzipSync(raw, { level: 9 });
  if (gz.length >= raw.length * 0.95) continue;
  await fs.writeFile(`${file}.gz`, gz);
  saved += raw.length - gz.length;
  count += 1;
}

if (problems.length > 0) {
  console.error('\npostbuild: FAILED');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log(`postbuild: ok · ${inline.length} inline script(s) match the CSP · no external URLs · no dev code · ${count} files pre-compressed (${Math.round(saved / 1024)} KB smaller)`);
console.log(`postbuild: CSP script hashes: ${hashes.join(' ')}`);
