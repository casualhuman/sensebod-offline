import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { listFiles } from './staticDir.ts';

/**
 * Online demo build only (VITE_DEMO=1, `npm run build:demo`). The Pi build never loads this plugin.
 *
 *  - starts the page at demo/main.ts (in-browser mock API) instead of src/app/main.tsx;
 *  - tells search engines not to index the page;
 *  - puts the bag's Content-Security-Policy in a <meta> tag, so it covers the app page only and
 *    never the games' own pages (static hosts merge header rules, which would stack two policies);
 *  - copies the small sample clips from mock/media to /media/ (about 100 KB in all);
 *  - writes the files static hosts read: `_redirects` (single-page fallback, Netlify and
 *    Cloudflare Pages), `_headers` (the bag's other security headers plus noindex) and robots.txt.
 *    Vercel reads app/vercel.json instead.
 */
export function demoPlugin(appDir: string): Plugin {
  const mediaDir = path.join(appDir, 'mock', 'media');
  // One source for the headers: the snippet the Pi's nginx uses (its inline-script hash is checked by postbuild).
  const snippet = readFileSync(path.join(appDir, 'deploy', 'security-headers.conf'), 'utf8');
  const value = (name: string): string => {
    const match = new RegExp(`add_header ${name} "([^"]+)"`).exec(snippet);
    if (!match || !match[1]) throw new Error(`demoPlugin: ${name} not found in deploy/security-headers.conf`);
    return match[1];
  };
  // frame-ancestors is not allowed in a <meta> policy; X-Frame-Options (in _headers / vercel.json) covers it.
  const metaCsp = value('Content-Security-Policy').replace(/;\s*frame-ancestors [^;]+/, '');
  return {
    name: 'sensebod-offline-demo',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('/src/app/main.tsx')) throw new Error('demoPlugin: index.html no longer loads /src/app/main.tsx');
        return html
          .replace('/src/app/main.tsx', '/demo/main.ts')
          .replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${metaCsp}" />\n    <meta name="robots" content="noindex, nofollow" />\n    <title>`)
          .replace('<title>Sensebod Offline</title>', '<title>Sensebod Offline (demo)</title>');
      },
    },
    async generateBundle() {
      for (const file of await listFiles(mediaDir)) {
        if (file === 'README.md') continue;
        this.emitFile({ type: 'asset', fileName: `media/${file}`, source: readFileSync(path.join(mediaDir, file)) });
      }
      const common = ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy'].map((name) => `  ${name}: ${value(name)}`);
      const headers = [
        '/*',
        ...common,
        '  X-Robots-Tag: noindex, nofollow',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '/games/*',
        "  Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'; base-uri 'none'",
        '/media/tryit/*',
        "  Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'",
        '',
      ];
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers.join('\n') });
      this.emitFile({ type: 'asset', fileName: '_redirects', source: '/*    /index.html   200\n' });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' });
    },
  };
}
