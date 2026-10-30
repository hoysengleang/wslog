import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Role } from '../../shared/protocol.js';
import { isLoopbackHost, type WslogConfig } from '../config.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Who is calling?
 * - the share token        → viewer (read-only)
 * - the admin token        → admin
 * - no token, from loopback → admin (the person running wslog), but only
 *   when the Host header is a local name too. Otherwise a website that
 *   rebinds its DNS to 127.0.0.1 would be admin when bound to 0.0.0.0.
 * - anything else          → rejected
 */
export function resolveRole(req: IncomingMessage, url: URL, config: WslogConfig): Role | null {
  const token = readToken(req, url);
  if (token) {
    if (safeEqual(token, config.adminToken)) return 'admin';
    if (safeEqual(token, config.shareToken)) return 'viewer';
    return null;
  }
  const fromLoopback = isLoopbackHost(normalizeAddress(req.socket.remoteAddress ?? ''));
  return fromLoopback && isLocalHostHeader(req.headers.host ?? '') ? 'admin' : null;
}

function readToken(req: IncomingMessage, url: URL): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-wslog-token'];
  if (typeof header === 'string' && header) return header;
  return url.searchParams.get('token') ?? undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeAddress(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/**
 * Browser-safety checks for the dashboard and API (not the proxy endpoint):
 * - Origin must match Host, so other websites cannot read traffic through
 *   the live WebSocket or call the API (cross-site WebSocket hijacking).
 *   `Origin: null` (sandboxed iframes, local files) is blocked too: the
 *   dashboard never sends it.
 * - When bound to loopback, Host must be a local name (DNS rebinding).
 */
export function checkBrowserSafety(req: IncomingMessage, config: WslogConfig): void {
  const host = req.headers.host ?? '';
  if (isLoopbackHost(config.host) && !isLocalHostHeader(host)) {
    throw new HttpError(403, `Host "${host}" is not allowed. wslog only answers to localhost.`);
  }
  const origin = req.headers.origin;
  if (origin !== undefined && originHost(origin) !== host) {
    throw new HttpError(403, `Cross-origin request from ${origin || '(empty origin)'} blocked`);
  }
}

function originHost(origin: string): string | undefined {
  try {
    return new URL(origin).host;
  } catch {
    return undefined; // includes the opaque origin "null"
  }
}

function isLocalHostHeader(host: string): boolean {
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname.endsWith('.localhost') || isLoopbackHost(hostname);
}
