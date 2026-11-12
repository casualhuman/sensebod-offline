/*
 * Reviewer B: static scan of the production build.
 *   node docs/reviews/evidence/dist-scan.cjs app/dist [/path/to/dist-with-sourcemaps]
 * 1. counts browser-API / risky-construct occurrences per start script
 * 2. extracts the CSS that the build embeds in the JS chunks and lists the
 *    properties / at-rules / selectors newer than the Chrome 58 floor
 * 3. (with a source-map build) lists the core-js modules in the polyfill chunk
 */
const fs = require('fs');
const path = require('path');
const dist = process.argv[2];
const mapDist = process.argv[3];
const assets = path.join(dist, 'assets');
const js = fs.readdirSync(assets).filter((f) => f.endsWith('.js'));

const WORDS = ['new URL(', 'URLSearchParams', '.difference(', '.intersection(', 'getOrInsertComputed', 'structuredClone', 'queueMicrotask', 'ResizeObserver',
  'IntersectionObserver', 'AbortController', 'requestIdleCallback', 'MessageChannel', 'localStorage', 'sessionStorage', 'document.cookie', 'innerHTML',
  'dangerouslySetInnerHTML', 'eval(', 'new Function', 'Function(', 'setInterval', 'requestAnimationFrame', 'console.', 'serviceWorker', 'XMLHttpRequest', 'fetch(',
  'Kitchen', '__dev', '__mock', 'sensebod.test', 'bad_credentials', 'development', 'sourceMappingURL', 'globalThis', '.replaceAll(', '.at(', 'Object.fromEntries',
  '.flat(', '.flatMap(', '.finally(', 'Intl.', 'navigator.', 'scrollIntoView', 'focus({', 'preventScroll', 'matchMedia', 'attachShadow', 'customElements'];
console.log('occurrences'.padEnd(28) + js.map((f) => f.replace(/-legacy-.*$/, '').padStart(16)).join(''));
for (const w of WORDS) {
  const counts = js.map((f) => fs.readFileSync(path.join(assets, f), 'utf8').split(w).length - 1);
  if (counts.some(Boolean)) console.log(w.padEnd(28) + counts.map((c) => String(c).padStart(16)).join(''));
}

// CSS embedded in the chunks: plugin-legacy stores it as a string literal that contains @font-face / .sb- rules.
let css = '';
for (const f of js) {
  const text = fs.readFileSync(path.join(assets, f), 'utf8');
  let from = 0;
  for (;;) {
    const start = text.indexOf('.textContent=`', from);
    if (start === -1) break;
    let end = start + 14;
    while (end < text.length && !(text[end] === '`' && text[end - 1] !== '\\')) end += 1;
    css += text.slice(start + 14, end) + '\n';
    from = end;
  }
}
console.log('\nembedded CSS: ' + css.length + ' bytes');
const CSS_CHECKS = {
  'flex/any gap (Chrome 66 grid, 84 flex)': /[;{](?:row-|column-)?gap:/g,
  'grid-gap (ok, 57)': /grid-gap:/g,
  'inset (87)': /[;{]inset:/g,
  'aspect-ratio (88)': /aspect-ratio:/g,
  'clamp/min/max() (79)': /(?:clamp|[^-a-z]min|[^-a-z]max)\(/g,
  ':focus-visible (86)': /:focus-visible/g,
  ':focus-within (60)': /:focus-within/g,
  ':is/:where/:has': /:(?:is|where|has)\(/g,
  'place-* (59)': /place-(?:items|content|self):/g,
  'space-evenly (60)': /space-evenly/g,
  'overscroll-behavior (63)': /overscroll-behavior/g,
  'scroll-behavior (61)': /scroll-behavior/g,
  'env()/dvh/svh': /env\(|\d(?:dvh|svh|lvh)/g,
  'logical properties (69-87)': /(?:margin|padding|border|inset)-(?:inline|block)|inline-size|block-size/g,
  'position:sticky': /position:(?:-webkit-)?sticky/g,
  'object-fit (ok)': /object-fit:/g,
  'unprefixed appearance (84)': /[;{]appearance:/g,
  '-webkit-appearance': /-webkit-appearance:/g,
  'text-underline-offset/decoration-thickness (87)': /text-underline-offset|text-decoration-thickness/g,
  '#rrggbbaa (62)': /#[0-9a-f]{8}\b|#[0-9a-f]{4}[;} ,)]/gi,
  'color-mix / nesting &': /color-mix|[{;]\s*&/g,
  '@media prefers-reduced-motion (74)': /prefers-reduced-motion/g,
  '@supports': /@supports/g,
  'font-display (60)': /font-display/g,
  'animation / transition': /[;{](?:animation|transition)(?:-[a-z]+)?:/g,
  'var(--': /var\(--/g,
  'display:grid': /display:(?:inline-)?grid/g,
  'display:flex': /display:(?:inline-)?flex/g,
  'user-select unprefixed': /[;{]user-select:/g,
  'touch-action': /touch-action/g,
  'line-clamp': /line-clamp/g,
  'overflow-wrap:anywhere (80)': /overflow-wrap:anywhere/g,
  'text-size-adjust': /text-size-adjust/g,
  'min-height:100vh': /100vh/g,
  ':not(a,b) lists (88)': /:not\([^)]*,[^)]*\)/g,
  'url(': /url\([^)]*\)/g,
};
for (const [name, re] of Object.entries(CSS_CHECKS)) {
  const hits = css.match(re) || [];
  console.log('  ' + String(hits.length).padStart(4) + '  ' + name + (hits.length && hits.length <= 12 && /url|rrggbbaa|sticky/.test(name) ? '  ' + [...new Set(hits)].join(' ') : ''));
}
if (process.argv.includes('--css')) fs.writeFileSync(process.argv[process.argv.indexOf('--css') + 1], css);

if (mapDist) {
  const dir = path.join(mapDist, 'assets');
  for (const f of fs.readdirSync(dir).filter((x) => /^polyfills.*\.map$/.test(x))) {
    const map = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const mods = map.sources.filter((s) => /core-js\/modules\//.test(s)).map((s) => s.replace(/.*modules\//, '').replace('.js', ''));
    console.log('\n' + mods.length + ' core-js polyfill modules (' + map.sources.length + ' source files in the chunk):\n' + mods.join(' '));
    console.log('other sources: ' + map.sources.filter((s) => !/core-js/.test(s)).join(', '));
  }
}
