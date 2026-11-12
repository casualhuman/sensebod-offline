import { createHash } from 'node:crypto';
import { createReadStream, promises as fs, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

/** Content types for the few file kinds the dev helpers serve. */
const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.vtt': 'text/vtt; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** List every file below `dir`, as paths relative to it (posix separators). */
export async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Short hash of every file's path and content; changes when any file changes. */
export async function hashDir(dir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const rel of await listFiles(dir)) {
    hash.update(rel);
    hash.update(await fs.readFile(path.join(dir, rel)));
  }
  return hash.digest('hex').slice(0, 10);
}

/**
 * Minimal static file responder with byte-range support, used only by the dev
 * and preview servers (illustrations and mock media). Returns false when the
 * file does not exist so the caller can fall through.
 */
export function serveFile(root: string, relPath: string, req: IncomingMessage, res: ServerResponse): boolean {
  const safe = path.normalize(decodeURIComponent(relPath)).replace(/^([/\\]|\.\.[/\\])+/, '');
  const file = path.join(root, safe);
  if (!file.startsWith(root)) return false;
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return false;
    size = stat.size;
  } catch {
    return false;
  }
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return true;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Length', size);
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
