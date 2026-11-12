import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import { handleMockRequest, mockControls } from '../mock/handler.ts';
import { serveFile } from './staticDir.ts';

const MAX_JSON_BYTES = 1024 * 1024;

/**
 * Mock backend for the dev server and `vite preview`.
 *
 * Runs entirely inside the Node dev server: `/api/v1/*` is answered by the
 * same in-memory handler the unit tests use, and `/media/*` serves the small
 * sample clips in `mock/media` with byte-range support. Nothing from `mock/`
 * is ever imported by `src/`, so none of it reaches the production bundle.
 */
export function mockApiPlugin(mockDir: string): Plugin {
  const mediaDir = path.join(mockDir, 'media');
  // A little latency so loading states are visible while developing.
  // MOCK_DELAY_MS=0 npm run dev  turns it off; a large value imitates a busy Pi.
  mockControls.setDelay(Number(process.env.MOCK_DELAY_MS ?? 150));
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const [pathname = '', search = ''] = (req.url ?? '').split('?');
    if (pathname.startsWith('/media/')) {
      if (!serveFile(mediaDir, pathname.slice('/media/'.length), req, res)) {
        res.statusCode = 404;
        res.end('Not found');
      }
      return;
    }
    if (!pathname.startsWith('/api/')) return next();

    const contentType = String(req.headers['content-type'] ?? '');
    const isJson = contentType.includes('application/json');
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      // Uploads are counted, not kept: the mock only needs the size.
      if (isJson && received <= MAX_JSON_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      let body: unknown;
      if (isJson && chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = undefined;
        }
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key.toLowerCase()] = value;
      }
      handleMockRequest({
        method: (req.method ?? 'GET').toUpperCase(),
        path: pathname,
        query: new URLSearchParams(search),
        headers,
        body,
        bodyBytes: received,
      })
        .then((result) => {
          res.statusCode = result.status;
          res.setHeader('Cache-Control', 'no-store');
          for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
          if (result.body === undefined) return res.end();
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(result.body));
        })
        .catch((error: unknown) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { code: 'server_error', message: String(error) } }));
        });
    });
  };
  return {
    name: 'sensebod-mock-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
