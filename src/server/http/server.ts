import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { LIVE_PATH, PROXY_PREFIX } from '../../shared/protocol.js';
import type { WslogContext } from '../context.js';
import type { WebSocketProxy } from '../proxy/proxy.js';
import { checkBrowserSafety, HttpError, resolveRole } from './auth.js';
import type { LiveHub } from './live.js';
import { sendJson } from './router.js';
import { createStaticHandler } from './static.js';
import { rejectUpgrade } from './upgrade.js';

export interface HttpServerDeps {
  ctx: WslogContext;
  proxy: WebSocketProxy;
  live: LiveHub;
  webRoot: string;
}

/**
 * One HTTP server, three jobs:
 *   /p/<target>/...  WebSocket proxy (what your app connects to)
 *   /api/...         REST API + /api/live stream for the dashboard
 *   everything else  the dashboard itself
 */
export function createHttpServer({ ctx, proxy, live, webRoot }: HttpServerDeps): Server {
  const serveStatic = createStaticHandler(webRoot);

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => sendError(res, err, ctx));
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = parseUrl(req);
    if (url.pathname.startsWith('/api/')) {
      checkBrowserSafety(req, ctx.config);
      const role = resolveRole(req, url, ctx.config);
      if (!role) throw new HttpError(401, 'Unauthorized. Open the dashboard with the link that includes ?token=…');
      if (!(await ctx.router.handle(req, res, url, role))) throw new HttpError(404, 'Not found');
      return;
    }
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket' });
      res.end('This is a wslog WebSocket proxy URL. Connect to it with a WebSocket client (ws://...).\n');
      return;
    }
    serveStatic(req, res, url.pathname);
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', (err) => ctx.logger.debug(`upgrade socket error: ${err.message}`));
    try {
      const url = parseUrl(req);
      if (url.pathname.startsWith(PROXY_PREFIX)) {
        const id = url.pathname.slice(PROXY_PREFIX.length).split('/')[0] ?? '';
        const target = ctx.targets.get(id);
        if (!target) return proxy.rejectUnknownTarget(req, socket, id);
        return proxy.handleUpgrade(req, socket, head, target);
      }
      if (url.pathname === LIVE_PATH) {
        checkBrowserSafety(req, ctx.config);
        const role = resolveRole(req, url, ctx.config);
        if (!role) return rejectUpgrade(socket, 401);
        return live.handleUpgrade(req, socket, head, role);
      }
      rejectUpgrade(socket, 404);
    } catch (err) {
      rejectUpgrade(socket, err instanceof HttpError ? err.status : 500, err instanceof Error ? err.message : undefined);
    }
  });

  return server;
}

function parseUrl(req: IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://wslog.local');
  } catch {
    // e.g. an absolute-form target like `GET http://[x/` — must not crash the process.
    throw new HttpError(400, 'Invalid request URL');
  }
}

function sendError(res: ServerResponse, err: unknown, ctx: WslogContext): void {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  if (status >= 500) ctx.logger.error(message, err);
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { error: status >= 500 ? 'Internal error' : message });
}
