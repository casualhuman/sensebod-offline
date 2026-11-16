/*
 * The Express application: one process, one writer connection (R-12).
 *
 * Order matters:
 *   request state → request log → maintenance → Host allow-list → CSRF
 *   → routes that stream raw bodies to disk (uploads, pictures; NO body parser, R-1)
 *   → small JSON body reader → every other route
 *
 * There is no framework access logger: the only per-request record is the
 * route-template event written by requestLog (R-9).
 */
import express, { Router, type Express } from 'express';
import { catalogRoutes } from './catalog/routes.ts';
import type { Ctx } from './core/context.ts';
import { API_BASE, csrf, errorHandler, hostAllowList, jsonBody, maintenanceGate, notFoundHandler, requestLog, requestState, sendJson } from './core/http.ts';
import { exportRoutes } from './exports/routes.ts';
import { overrideRoutes } from './identity/override.ts';
import { identityRoutes } from './identity/routes.ts';
import { learnerRoutes } from './learners/routes.ts';
import { uploadJsonRoutes, uploadRoutes } from './media/routes.ts';
import { devFiles } from './system/devFiles.ts';
import { systemRoutes } from './system/routes.ts';

export function buildApp(ctx: Ctx): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('query parser', 'simple');

  app.use(requestState(ctx));
  app.use(requestLog());
  app.use(maintenanceGate(ctx));
  app.use(hostAllowList(ctx));
  app.use(csrf());

  const api = Router();
  api.use(uploadRoutes(ctx));
  api.use(jsonBody());
  api.use(uploadJsonRoutes(ctx));
  api.use(systemRoutes(ctx));
  api.use(identityRoutes(ctx));
  api.use(overrideRoutes(ctx));
  api.use(catalogRoutes(ctx));
  api.use(learnerRoutes(ctx));
  api.use(exportRoutes(ctx));
  app.use(API_BASE, api);

  // On a bag nginx serves every static byte, media file and export. On a laptop the API can stand in for it.
  if (ctx.config.dev.serveFiles) app.use(devFiles(ctx));

  app.use(notFoundHandler());
  app.use(errorHandler());
  return app;
}

/** What is served while the database cannot be used: everything is 503 maintenance (DATABASE §9.3 step 5). */
export function buildMaintenanceApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res) => {
    res.setHeader('Retry-After', '30');
    sendJson(res, 503, { error: { code: 'maintenance', message: 'The bag is being looked after. Please try again later.' } });
  });
  return app;
}
