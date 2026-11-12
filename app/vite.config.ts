import path from 'node:path';
import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { illustrationsPlugin } from './build/illustrationsPlugin.ts';
import { mockApiPlugin } from './build/mockApiPlugin.ts';

const root = import.meta.dirname;

/**
 * Browser floor: Android 8 as shipped (Chrome / WebView 58), which a bag with
 * no internet never updates. See docs/ARCHITECTURE.md, "Browser target".
 *
 * ONE build for every device: the legacy (SystemJS) chunks only, compiled for
 * the list below with just the core-js polyfills the code really uses.
 * No separate "modern" build:
 *  - plugin-legacy 8 only calls a browser modern from Chrome 105 / Safari 16.4.
 *    With both builds, every Chrome 61-104 (most of the fleet) would download
 *    the modern entry, reject it, then download the legacy one as well.
 *  - one code path means what is tested is what every phone runs.
 *  - no inline `import 'data:…'` guard, so the CSP needs no `data:` script source.
 * Known cost: in this mode Vite delivers CSS inside the JS chunks and adds it
 * with a <style> element (there is no separate .css file), so the CSP allows
 * inline styles. Measured sizes and the reasoning are in docs/ARCHITECTURE.md.
 */
const TARGETS = ['chrome >= 58', 'firefox >= 60', 'safari >= 11', 'edge >= 16'];

export default defineConfig({
  root,
  plugins: [
    react(),
    legacy({ targets: TARGETS, renderModernChunks: false }),
    illustrationsPlugin(path.resolve(root, '../illustrations')),
    mockApiPlugin(path.resolve(root, 'mock')),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(root, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    // Keep CSS syntax at the Android 8 floor (no inset, no #rrggbbaa, no nesting).
    cssTarget: ['chrome58', 'safari11', 'firefox60'],
    // Never inline assets as data: URIs: the CSP then needs no `data:` source
    // and every font is a cacheable, content-hashed file.
    assetsInlineLimit: 0,
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Name each feature's entry chunk after the feature, so size reports
        // and server logs say "learner" / "lessons" / "admin", not "routes".
        chunkFileNames(chunk) {
          const feature = /[\\/]features[\\/]([^\\/]+)[\\/]routes\.tsx?$/.exec(chunk.facadeModuleId ?? '');
          return feature ? `assets/feature-${feature[1]}-[hash].js` : 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: { host: true, port: 5173, strictPort: false },
  preview: { host: true, port: 4173, strictPort: false },
});
