import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';

/** Headers that describe the client↔proxy hop and must not be copied upstream. */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'upgrade',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'content-length',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
  'sec-websocket-accept',
]);

/** Copy the client's handshake headers (cookies, auth, origin, ...) to the upstream request. */
export function forwardHeaders(req: IncomingMessage): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    headers[name] = value;
  }
  const clientIp = req.socket.remoteAddress;
  if (clientIp) {
    const prior = req.headers['x-forwarded-for'];
    headers['x-forwarded-for'] = prior ? `${String(prior)}, ${clientIp}` : clientIp;
  }
  return headers;
}

export function parseProtocols(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}
