#!/usr/bin/env node
/*
 * CSS floor check (run by `npm run lint`).
 *
 * The oldest phones run Chrome / WebView 58 and never update. CSS they do
 * not understand is dropped silently: nothing fails on a developer's
 * machine, and the page shows collapsed spacing or squashed pictures on the
 * phone. This script reads the source CSS (and inline `style={{ … }}` in
 * .tsx files) and fails on the features listed in docs/ARCHITECTURE.md
 * section 3.7, with file, line and what to use instead.
 *
 *   node scripts/check-css.mjs                 every .css and .tsx file under src/
 *   node scripts/check-css.mjs a.css b.tsx     only these files
 *   node scripts/check-css.mjs --stdin x.css   read one file from standard input
 *
 * A line that is correct although it matches a rule (a deliberate
 * enhancement with a working fallback) can carry the comment
 * `floor-ok: <reason>` on the same line or on the line above it.
 *
 * No dependencies: a small scanner, not a CSS parser. It understands
 * comments, strings, at-rule blocks and declaration blocks, which is all
 * these rules need.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(import.meta.dirname, '..');

/* ---- the rules ---- */

/** Selector text → problem. */
const SELECTOR_RULES = [
  [/:has\(/, '`:has()` needs Chrome 105. Use a class set from the component.'],
  [/:(is|where)\(/, '`:is()` / `:where()` need Chrome 88, and an unknown selector drops the whole rule. Write the selectors out.'],
  [/:focus-visible/, '`:focus-visible` needs Chrome 86, and an unknown selector drops the whole rule. Focus styling is global (base.css); use `:focus`.'],
  [/&/, 'CSS nesting needs Chrome 112. Write flat selectors.'],
];

/** At-rule prelude → problem. */
const AT_RULES = [
  [/^@container\b/, 'Container queries need Chrome 105. Use a media query.'],
  [/^@layer\b/, '`@layer` needs Chrome 99. Order the rules instead.'],
  [/^@media[^{]*\(\s*[a-z-]+\s*[<>]=?/, 'Range syntax in media queries needs Chrome 104. Use `min-width` / `max-width`.'],
];

/** Value text → problem (any property). */
const VALUE_RULES = [
  [/(^|[^a-z-])clamp\(/, '`clamp()` needs Chrome 79. Use a fixed size and a media query.'],
  [/(^|[^a-z-])(min|max)\(/, '`min()` / `max()` need Chrome 79. Use a fixed size and a media query.'],
  [/color-mix\(/, '`color-mix()` needs Chrome 111. Use a fixed colour from the tokens.'],
];

const GAP_PROPERTIES = ['gap', 'row-gap', 'column-gap'];

function checkDeclarations(declarations, report) {
  const names = declarations.map((d) => d.name);
  const display = declarations.filter((d) => d.name === 'display').map((d) => d.value);
  const isFlex = display.some((value) => /^(inline-)?flex\b/.test(value));
  const isColumns = names.some((name) => name === 'columns' || name === 'column-count' || name === 'column-width');

  declarations.forEach((declaration, index) => {
    const { name, value, line } = declaration;
    if (name === 'aspect-ratio') report(line, '`aspect-ratio` needs Chrome 88. Use `ScenePicture` or the `.sb-picture` padding box.');
    if (name === 'inset' || /^inset-(block|inline)/.test(name)) report(line, '`inset` needs Chrome 87. Use `top` / `right` / `bottom` / `left`.');
    if (GAP_PROPERTIES.indexOf(name) !== -1 && !(name === 'column-gap' && isColumns)) {
      if (isFlex) {
        report(line, `\`${name}\` on a flex container needs Chrome 84. Use margins, or the helpers \`.sb-stack\` and \`.sb-row\`.`);
      } else if (names.slice(0, index).indexOf('grid-' + name) === -1) {
        report(line, `\`${name}\` on a grid needs Chrome 66 (and on a flex container Chrome 84). For a grid write \`grid-${name}\` first, then \`${name}\`; for flex use margins.`);
      }
    }
    if (name === 'position' && value === 'sticky' && !declarations.some((d) => d.name === 'position' && d.value === '-webkit-sticky')) {
      report(line, '`position: sticky` also needs `position: -webkit-sticky` before it (as shell.css does).');
    }
    for (const [pattern, message] of VALUE_RULES) {
      if (pattern.test(value)) report(line, message);
    }
  });
}

/* ---- CSS scanner ---- */

/** Replaces comments and strings with spaces (newlines kept), and notes the `floor-ok` lines. */
function blank(text) {
  const allowed = new Set();
  let out = '';
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const two = text.substr(i, 2);
    const char = text[i];
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      const comment = text.slice(i, stop);
      const lines = comment.split('\n').length - 1;
      if (/floor-ok\s*:\s*\S/.test(comment)) {
        // The line the comment ends on, and the line after it.
        allowed.add(line + lines);
        allowed.add(line + lines + 1);
      }
      out += comment.replace(/[^\n]/g, ' ');
      line += lines;
      i = stop;
    } else if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== char && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += char + ' '.repeat(Math.max(0, j - i - 1)) + (text[j] === char ? char : '');
      i = text[j] === char ? j + 1 : j;
    } else {
      if (char === '\n') line += 1;
      out += char;
      i += 1;
    }
  }
  return { text: out, allowed };
}

export function checkCss(source) {
  const problems = [];
  const { text, allowed } = blank(source);
  const report = (line, message) => {
    if (!allowed.has(line)) problems.push({ line, message });
  };

  /** Open blocks: { kind: 'at' | 'rule', declarations } */
  const stack = [];
  let line = 1;
  let chunk = '';
  let chunkLine = 1;

  const startChunk = () => {
    chunk = '';
    chunkLine = line;
  };
  const addDeclaration = () => {
    const top = stack[stack.length - 1];
    const trimmed = chunk.trim();
    if (top && top.kind === 'rule' && trimmed) {
      const colon = trimmed.indexOf(':');
      if (colon > 0) {
        // The line of the first non-space character of the declaration.
        const lead = chunk.length - chunk.replace(/^\s+/, '').length;
        const offset = chunk.slice(0, lead).split('\n').length - 1;
        top.declarations.push({
          name: trimmed.slice(0, colon).trim().toLowerCase(),
          value: trimmed.slice(colon + 1).trim().replace(/\s*!important$/i, '').toLowerCase(),
          line: chunkLine + offset,
        });
      }
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') {
      const prelude = chunk.trim().replace(/\s+/g, ' ');
      const lead = chunk.length - chunk.replace(/^\s+/, '').length;
      const preludeLine = chunkLine + chunk.slice(0, lead).split('\n').length - 1;
      const parent = stack[stack.length - 1];
      if (prelude.charAt(0) === '@') {
        for (const [pattern, message] of AT_RULES) {
          if (pattern.test(prelude.toLowerCase())) report(preludeLine, message);
        }
        // @font-face and @page hold declarations; the others hold rules.
        stack.push({ kind: /^@(font-face|page)\b/i.test(prelude) ? 'rule' : 'at', declarations: [] });
      } else {
        if (parent && parent.kind === 'rule') report(preludeLine, 'CSS nesting needs Chrome 112. Write flat selectors.');
        for (const [pattern, message] of SELECTOR_RULES) {
          if (pattern.test(prelude)) report(preludeLine, message);
        }
        stack.push({ kind: 'rule', declarations: [] });
      }
      startChunk();
    } else if (char === '}') {
      addDeclaration();
      const closed = stack.pop();
      if (closed && closed.kind === 'rule') checkDeclarations(closed.declarations, report);
      startChunk();
    } else if (char === ';') {
      addDeclaration();
      startChunk();
    } else {
      if (char === '\n') line += 1;
      if (chunk === '' && char !== '\n') chunkLine = line;
      chunk += char;
      continue;
    }
    if (char === '\n') line += 1;
  }
  return problems.sort((a, b) => a.line - b.line);
}

/* ---- inline styles in .tsx ---- */

const STYLE_KEYS = [
  [/\baspectRatio\s*:/, '`aspectRatio` needs Chrome 88. Use `ScenePicture` or the `.sb-picture` padding box.'],
  [/\binset(Block|Inline)?\w*\s*:/, '`inset` needs Chrome 87. Use `top` / `right` / `bottom` / `left`.'],
  [/\b(gap|rowGap|columnGap)\s*:/, '`gap` in an inline style: flex gap needs Chrome 84, grid gap Chrome 66. Use margins or a CSS class with `grid-gap`.'],
  [/\b(clamp|min|max)\(/, '`clamp()` / `min()` / `max()` need Chrome 79. Use a fixed size and a media query.'],
  [/color-mix\(/, '`color-mix()` needs Chrome 111. Use a fixed colour from the tokens.'],
];

export function checkTsx(source) {
  const problems = [];
  const lines = source.split('\n');
  const pattern = /style=\{\{/g;
  let match;
  while ((match = pattern.exec(source))) {
    // Find the end of the object literal by counting braces.
    let depth = 0;
    let end = match.index + 'style={'.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(match.index, end + 1);
    const firstLine = source.slice(0, match.index).split('\n').length;
    body.split('\n').forEach((text, offset) => {
      const lineNumber = firstLine + offset;
      const here = lines[lineNumber - 1] ?? '';
      const above = lines[lineNumber - 2] ?? '';
      if (/floor-ok\s*:\s*\S/.test(here) || /floor-ok\s*:\s*\S/.test(above)) return;
      // Math.min( / Math.max( are JavaScript, not CSS.
      const cleaned = text.replace(/Math\.(min|max)\(/g, 'Math_(');
      for (const [test, message] of STYLE_KEYS) {
        if (test.test(cleaned)) problems.push({ line: lineNumber, message });
      }
    });
  }
  return problems;
}

/* ---- command line ---- */

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(css|tsx)$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

function check(file, source) {
  return file.endsWith('.css') ? checkCss(source) : checkTsx(source);
}

async function main() {
  const args = process.argv.slice(2);
  const results = [];
  if (args[0] === '--stdin') {
    const name = args[1] ?? 'stdin.css';
    let source = '';
    for await (const piece of process.stdin) source += piece;
    results.push([name, check(name, source)]);
  } else {
    const files = args.length > 0 ? args.map((file) => path.resolve(file)) : (await walk(path.join(appDir, 'src'))).sort();
    for (const file of files) {
      results.push([path.relative(appDir, file), check(file, await fs.readFile(file, 'utf8'))]);
    }
  }
  let count = 0;
  for (const [file, problems] of results) {
    for (const problem of problems) {
      count += 1;
      console.error(`${file}:${problem.line}  ${problem.message}`);
    }
  }
  if (count > 0) {
    console.error(`\ncheck-css: ${count} problem(s). These features do not exist on the Android 8 floor (Chrome 58); see docs/ARCHITECTURE.md section 3.7.`);
    process.exit(1);
  }
  console.log(`check-css: ok · ${results.length} file(s) checked against the Android 8 CSS floor`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await main();
}
