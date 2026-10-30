import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../../shared/protocol.js';
import { HttpError } from './auth.js';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  role: Role;
  body<T>(): Promise<T>;
}

export type RouteHandler = (ctx: RouteContext) => unknown;

export interface RouteOptions {
  /** Minimum role. Defaults to `viewer` (anyone with access). */
  role?: Role;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
  role: Role;
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Tiny method + path router. Handlers return a value to send as JSON,
 * or write to `res` themselves and return `undefined`.
 */
export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('GET', path, handler, options);
  }
  post(path: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('POST', path, handler, options);
  }
  delete(path: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('DELETE', path, handler, options);
  }

  add(method: string, path: string, handler: RouteHandler, options: RouteOptions = {}): this {
    const keys: string[] = [];
    const source = path.replace(/\/:(\w+)/g, (_m, key: string) => {
      keys.push(key);
      return '/([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}/?$`), keys, handler, role: options.role ?? 'viewer' });
    return this;
  }

  /** Returns false when no route matches the path. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, role: Role): Promise<boolean> {
    let pathMatched = false;
    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== req.method && !(route.method === 'GET' && req.method === 'HEAD')) continue;
      if (route.role === 'admin' && role !== 'admin') throw new HttpError(403, 'This link is read-only');

      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodePathSegment(match[i + 1]!)]));
      const result = await route.handler({ req, res, url, params, role, body: () => readJson(req) });
      if (!res.writableEnded && result !== undefined) sendJson(res, 200, result);
      else if (!res.writableEnded) res.writeHead(204).end();
      return true;
    }
    if (pathMatched) throw new HttpError(405, 'Method not allowed');
    return false;
  }
}

/** `decodeURIComponent` that answers 400 instead of throwing on bad `%` escapes. */
export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'Malformed URL encoding');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  if (!req.headers['content-type']?.includes('application/json')) {
    throw new HttpError(415, 'Expected Content-Type: application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
