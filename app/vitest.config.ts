import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

// Kept separate from vite.config.ts on purpose: tests need none of the build
// plugins (legacy chunks, illustration copy, dev mock server).
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@shared': path.resolve(root, 'src/shared'),
      '@mock': path.resolve(root, 'mock'),
    },
  },
  define: { __ILLUSTRATIONS_VERSION__: JSON.stringify('test') },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/shared/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.ts', 'scripts/**/*.test.mjs'],
    css: false,
    restoreMocks: true,
  },
});
