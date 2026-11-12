import { describe, expect, it } from 'vitest';
import { checkCss, checkTsx } from './check-css.mjs';

const lines = (problems) => problems.map((problem) => problem.line);
const messages = (problems) => problems.map((problem) => problem.message).join('\n');

describe('CSS floor check', () => {
  it('accepts the patterns the shared CSS uses', () => {
    const css = `
      .sb-grid { display: grid; grid-template-columns: minmax(0, 1fr); grid-gap: 16px; gap: 16px; }
      .sb-row { display: flex; margin-left: -8px; }
      .sticky { position: -webkit-sticky; position: sticky; top: 0; }
      .shadow { box-shadow: inset 0 5px 0 #000; max-width: calc(100% - 2 * var(--sb-gutter)); }
      .cols { column-count: 2; column-gap: 16px; }
      @media (min-width: 720px) { .a { margin: 0 auto; } }
      @media (prefers-reduced-motion: no-preference) { .b { transition: opacity 0.15s; } }
      @font-face { font-family: 'Poppins'; src: url('x.woff2') format('woff2'); }
      @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      .c::before { content: 'min(1px, 2px) { gap: 1px }'; }
      /* aspect-ratio: 1 / 1 and :has() in a comment are fine */
    `;
    expect(checkCss(css)).toEqual([]);
  });

  it('reports gap on a flex container, also with other declarations between', () => {
    const problems = checkCss('.a {\n  display: inline-flex;\n  color: red;\n  gap: 8px;\n  row-gap: 4px;\n}');
    expect(lines(problems)).toEqual([4, 5]);
    expect(messages(problems)).toContain('flex container needs Chrome 84');
  });

  it('reports gap on a grid unless grid-gap comes first', () => {
    expect(lines(checkCss('.a { display: grid;\n gap: 8px; }'))).toEqual([2]);
    expect(lines(checkCss('.a { display: grid;\n gap: 8px;\n grid-gap: 8px; }'))).toEqual([2]);
    expect(checkCss('.a { display: grid; grid-gap: 8px; gap: 8px; }')).toEqual([]);
    // No display in this rule: it may be a flex or a grid container elsewhere, so it is still reported.
    expect(lines(checkCss('.a { gap: 8px; }'))).toEqual([1]);
  });

  it('reports each banned property, function, selector and at-rule with its line', () => {
    const css = [
      '.a { aspect-ratio: 16 / 9; }',
      '.b { inset: 0; }',
      '.c { width: clamp(1px, 2vw, 3px); }',
      '.d { width: min(10px, 2vw); height: MAX(1px, 2px); }',
      '.e { color: color-mix(in srgb, red, blue); }',
      '.f:has(.g) { color: red; }',
      '.h:is(.i, .j) { color: red; }',
      '.k:focus-visible { outline: 0; }',
      '@container (min-width: 300px) { .l { color: red; } }',
      '.m { color: red; .n { color: blue; } }',
      '.o { position: sticky; }',
      '@media (width >= 720px) { .p { color: red; } }',
      '.q { inset-inline-start: 0; }',
    ].join('\n');
    expect(lines(checkCss(css))).toEqual([1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('reports a problem inside a media query on the right line', () => {
    expect(lines(checkCss('.a { color: red; }\n@media (min-width: 720px) {\n  .b {\n    display: flex;\n    gap: 4px;\n  }\n}'))).toEqual([5]);
  });

  it('lets a line through when it says why, on the same line or the line above', () => {
    expect(checkCss('/* floor-ok: old browsers drop the rule and keep the ring */\n.a:not(:focus-visible) { outline: none; }')).toEqual([]);
    expect(checkCss('.a { aspect-ratio: 1; /* floor-ok: the padding box below is the fallback */ }')).toEqual([]);
    // A bare marker without a reason does not count.
    expect(lines(checkCss('.a { aspect-ratio: 1; /* floor-ok */ }'))).toEqual([1]);
    // And it covers one line only.
    expect(lines(checkCss('/* floor-ok: reason */\n.a { color: red; }\n.b { inset: 0; }'))).toEqual([3]);
  });
});

describe('inline style check in .tsx', () => {
  it('reports banned keys and functions inside style={{ … }} only', () => {
    const tsx = ['const gap = 4;', 'export const A = () => (', '  <div', '    style={{', "      display: 'flex',", '      gap: 8,', "      aspectRatio: '1 / 1',", "      width: 'clamp(1px, 2vw, 3px)',", '      height: Math.max(1, 2),', '    }}', '  />', ');'].join('\n');
    expect(lines(checkTsx(tsx))).toEqual([6, 7, 8]);
  });

  it('accepts ordinary inline styles and the floor-ok marker', () => {
    expect(checkTsx("<span style={{ display: 'block', width, height, marginLeft: 8 }} />")).toEqual([]);
    expect(checkTsx("// floor-ok: only used on the admin laptop\n<span style={{ gap: 8 }} />")).toEqual([]);
  });
});
