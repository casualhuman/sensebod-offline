/*
 * Reviewer A evidence runner. Runs the repro tests in this folder against the
 * app's source without adding anything to app/. Run it from app/:
 *
 *   cd app && npx vitest run --config ../docs/reviews/evidence/vitest.evidence.config.mjs
 *
 * Each test PASSES when the defect it describes is present (the assertions
 * describe the faulty behaviour), so a fix makes the matching test fail; the
 * file names carry the finding ids from reviewer-a-code-quality.md.
 *
 * No imports from node_modules here: this file lives outside app/ and is
 * resolved from its own folder, so it exports a plain config object.
 */
import path from 'node:path';

const app = process.cwd(); // must be app/
const mods = path.join(app, 'node_modules');

export default {
  root: app,
  resolve: {
    alias: [
      { find: '@shared', replacement: path.join(app, 'src/shared') },
      { find: '@mock', replacement: path.join(app, 'mock') },
      { find: '@app', replacement: path.join(app, 'src/app') },
      // The tests live outside app/, so bare imports are pointed at app/node_modules.
      { find: /^(react|react-dom|@testing-library\/react|@testing-library\/jest-dom)(\/.*)?$/, replacement: `${mods}/$1$2` },
    ],
  },
  define: { __ILLUSTRATIONS_VERSION__: JSON.stringify('test') },
  esbuild: { jsx: 'automatic' },
  server: { fs: { allow: [path.resolve(app, '..')] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.join(app, 'src/shared/test/setup.ts')],
    include: ['../docs/reviews/evidence/*.evidence.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
};
