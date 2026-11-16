import path from 'node:path';
import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
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
/** e.g. http://127.0.0.1:8000 — the Sensebod Offline backend started with `npm run dev` in backend/. */
const REAL_API = process.env.REAL_API ?? '';
const proxy = REAL_API
  ? {
      // The Host header is passed on unchanged, as nginx does on the bag: the backend compares the
      // browser's Origin with it (CSRF), so rewriting it would refuse every save and sign-in.
      '/api': { target: REAL_API, changeOrigin: false, xfwd: true },
      '/media': { target: REAL_API, changeOrigin: false },
    }
  : undefined;

const TARGETS = ['chrome >= 58', 'firefox >= 60', 'safari >= 11', 'edge >= 16'];

/**
 * Game files (public/games/<id>/...) get the same two headers nginx gives them on the bag
 * (docs/GAMES.md, section 5), so a game that the bag's policy would stop is stopped here too.
 */
const gameHeaders: Plugin = {
  name: 'sensebod-offline-game-headers',
  configureServer(server) {
    server.middlewares.use(setGameHeaders);
  },
  configurePreviewServer(server) {
    server.middlewares.use(setGameHeaders);
  },
};
function setGameHeaders(req: { url?: string }, res: { setHeader(name: string, value: string): void }, next: () => void): void {
  if (/^\/games\/[^/?]+\/[^?]+/.test(req.url ?? '')) {
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'; base-uri 'none'");
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  next();
}

export default defineConfig({
  root,
  plugins: [
    react(),
    gameHeaders,
    legacy({ targets: TARGETS, renderModernChunks: false }),
    illustrationsPlugin(path.resolve(root, '../illustrations')),
    // REAL_API set (npm run dev:real): no mock; /api and /media go to the real backend, as nginx does on the bag.
    ...(REAL_API ? [] : [mockApiPlugin(path.resolve(root, 'mock'))]),
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
  server: { host: true, port: 5173, strictPort: false, proxy },
  preview: { host: true, port: 4173, strictPort: false, proxy },
});
