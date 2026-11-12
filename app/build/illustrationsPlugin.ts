import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import { hashDir, listFiles, serveFile } from './staticDir.ts';

/**
 * Illustration pipeline.
 *
 * The cast and scene SVGs live once, in the repository's `illustrations/`
 * folder. They are never imported into JavaScript. This plugin
 *  - serves them at `/illustrations/<portal>/<cast|scenes>/<name>.svg` in dev and preview,
 *  - copies them unchanged to `dist/illustrations/` on build,
 *  - exposes `__ILLUSTRATIONS_VERSION__`, a hash of the folder, which the
 *    `illustrationUrl()` helper appends as `?v=` so the Pi can cache the files
 *    for a long time and still pick up a changed drawing after an update.
 */
export function illustrationsPlugin(sourceDir: string): Plugin {
  let outDir = '';
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith('/illustrations/')) return next();
    if (!serveFile(sourceDir, url.slice('/illustrations/'.length), req, res)) {
      res.statusCode = 404;
      res.end('Not found');
    }
  };
  return {
    name: 'sensebod-illustrations',
    async config() {
      return { define: { __ILLUSTRATIONS_VERSION__: JSON.stringify(await hashDir(sourceDir)) } };
    },
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      // dist/illustrations exists after a build; this keeps preview working
      // even when someone previews without rebuilding after adding a drawing.
      server.middlewares.use(middleware);
    },
    async closeBundle() {
      if (!outDir || this.environment?.config.command !== 'build') return;
      const files = (await listFiles(sourceDir)).filter((f) => f.endsWith('.svg'));
      for (const rel of files) {
        const to = path.join(outDir, 'illustrations', rel);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(path.join(sourceDir, rel), to);
      }
    },
  };
}
