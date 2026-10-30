import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { decodePathSegment } from './router.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>wslog</title>
<body style="font:15px system-ui;padding:40px;max-width:640px">
<h1>wslog is running</h1>
<p>The dashboard has not been built yet. Run <code>npm run build:web</code>,
or use <code>npm run dev</code> and open the Vite URL.</p>
<p>The proxy and API work without it.</p></body>`;

/** Serves the built dashboard with an SPA fallback to index.html. */
export function createStaticHandler(root: string) {
  const index = join(root, 'index.html');

  return (req: IncomingMessage, res: ServerResponse, pathname: string): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (!existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(NOT_BUILT);
      return;
    }

    let file = normalize(join(root, decodePathSegment(pathname)));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = index;

    const isAsset = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // Other sites may not frame the dashboard (clickjacking on Clear, Remove, ...).
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
}
