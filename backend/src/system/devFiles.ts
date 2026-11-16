/*
 * Laptop only (`dev.serve_files`): stand in for nginx by serving /media/ from
 * the media store and, when `paths.web_dir` is set, the built frontend with
 * its single-page fallback. On a bag nginx serves every one of these bytes
 * and this module is never mounted.
 */
import express, { Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from '../core/context.ts';

export function devFiles(ctx: Ctx): Router {
  const router = Router();
  router.use(
    '/media',
    express.static(ctx.paths.media, {
      dotfiles: 'deny',
      index: false,
      fallthrough: true,
      setHeaders(res) {
        // The same sandbox nginx puts on uploaded files (Reviewer B B-03).
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );
  const web = ctx.config.paths.webDir;
  if (web && existsSync(join(web, 'index.html'))) {
    router.use(express.static(web, { dotfiles: 'deny', index: 'index.html' }));
    router.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/media/') || /\.[A-Za-z0-9]{1,8}$/.test(req.path)) {
        next();
        return;
      }
      res.sendFile(join(web, 'index.html'));
    });
  }
  return router;
}
