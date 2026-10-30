import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { ConnectionFailure, TargetInfo } from '../../shared/protocol.js';
import type { ConnectionRegistry } from '../connections.js';
import type { Masker } from '../masking.js';
import type { Recorder } from '../recorder.js';
import { buildUpstreamUrl } from '../targets.js';
import type { Logger } from '../util/logger.js';
import { rejectUpgrade } from '../http/upgrade.js';
import { forwardHeaders, parseProtocols } from './headers.js';

export interface ProxyDeps {
  connections: ConnectionRegistry;
  recorder: Recorder;
  masker: Masker;
  logger: Logger;
  handshakeTimeoutMs?: number;
}

/**
 * Bridges a client WebSocket to its target server and records every frame.
 *
 * The upstream connection is opened first; the client handshake is only
 * completed once the server accepted, so the negotiated subprotocol and
 * any rejection status (401, 404, ...) are passed through to the client.
 */
export class WebSocketProxy {
  private readonly wss: WebSocketServer;
  private readonly selectedProtocol = new WeakMap<IncomingMessage, string>();
  private readonly sockets = new Set<WebSocket>();
  /** Open bridges by connection id, so removing a target can disconnect its apps. */
  private readonly bridges = new Map<string, { targetId: string; close(reason: string): void }>();

  constructor(private readonly deps: ProxyDeps) {
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (_offered, req) => this.selectedProtocol.get(req) ?? false,
    });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: TargetInfo): void {
    const { connections, masker, logger } = this.deps;
    const requestPath = req.url ?? target.proxyPath;
    const upstreamUrl = buildUpstreamUrl(target, requestPath);

    const connection = connections.create({
      targetId: target.id,
      path: masker.url(requestPath),
      upstreamUrl: masker.url(upstreamUrl),
      clientAddress: req.socket.remoteAddress ?? 'unknown',
      userAgent: req.headers['user-agent'],
    });

    const upstream = new WebSocket(upstreamUrl, parseProtocols(req.headers['sec-websocket-protocol']), {
      headers: forwardHeaders(req),
      handshakeTimeout: this.deps.handshakeTimeoutMs ?? 10_000,
      followRedirects: false,
    });
    upstream.binaryType = 'nodebuffer';
    let settled = false;

    const fail = (status: number, message: string, failure: ConnectionFailure) => {
      if (settled) return;
      settled = true;
      logger.debug(`proxy ${connection.id}: ${message}`);
      connections.update(connection.id, { status: 'error', error: message, failure, closedBy: 'proxy' });
      rejectUpgrade(socket, status, message);
    };

    // Client gave up while we were still dialing the server.
    const onEarlyClose = () => {
      if (settled) return;
      settled = true;
      upstream.terminate();
      connections.update(connection.id, { status: 'closed', closedBy: 'client' });
    };
    socket.once('close', onEarlyClose);

    upstream.once('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 502;
      res.resume();
      fail(status, `Server rejected the handshake: ${status} ${res.statusMessage ?? ''}`.trim(), 'rejected');
      upstream.terminate();
    });

    upstream.on('error', (err) => {
      if (!settled) fail(502, `Could not reach ${masker.url(upstreamUrl)}: ${err.message}`, 'unreachable');
    });

    upstream.once('open', () => {
      if (settled) return upstream.terminate();
      settled = true;
      socket.off('close', onEarlyClose);
      if (upstream.protocol) this.selectedProtocol.set(req, upstream.protocol);
      this.wss.handleUpgrade(req, socket, head, (client) => this.bridge(client, upstream, connection.id, target.id));
    });
  }

  /**
   * An app used a proxy URL with no target behind it. Record the attempt so the
   * dashboard can say so, instead of the app failing with a 404 nobody sees.
   */
  rejectUnknownTarget(req: IncomingMessage, socket: Duplex, targetId: string): void {
    const { connections, masker } = this.deps;
    const message = 'No target for this proxy URL. Paste the server URL in the dashboard again; the proxy URL will be the same.';
    const connection = connections.create({
      targetId,
      path: masker.url(req.url ?? ''),
      upstreamUrl: '',
      clientAddress: req.socket.remoteAddress ?? 'unknown',
      userAgent: req.headers['user-agent'],
    });
    connections.update(connection.id, { status: 'error', error: message, failure: 'no-target', closedBy: 'proxy' });
    rejectUpgrade(socket, 404, message);
  }

  private bridge(client: WebSocket, upstream: WebSocket, connectionId: string, targetId: string): void {
    const { connections, recorder, logger } = this.deps;
    client.binaryType = 'nodebuffer';
    this.sockets.add(client);
    this.sockets.add(upstream);
    connections.update(connectionId, { status: 'open', protocol: upstream.protocol || undefined });

    // Forward first, then record: recording (masking, storage) must never delay traffic.
    client.on('message', (data, isBinary) => {
      const buffer = toBuffer(data);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(buffer, { binary: isBinary });
      recorder.record({ connectionId, targetId, direction: 'out', data: buffer, isBinary });
    });
    upstream.on('message', (data, isBinary) => {
      const buffer = toBuffer(data);
      if (client.readyState === WebSocket.OPEN) client.send(buffer, { binary: isBinary });
      recorder.record({ connectionId, targetId, direction: 'in', data: buffer, isBinary });
    });

    let closed = false;
    let closedByProxy = false;
    this.bridges.set(connectionId, {
      targetId,
      close: (why) => {
        closedByProxy = true;
        client.close(1001, why);
        upstream.close(1001, why);
      },
    });
    const onClose = (side: 'client' | 'server', other: WebSocket) => (code: number, reason: Buffer) => {
      this.sockets.delete(side === 'client' ? client : upstream);
      this.sockets.delete(other);
      this.bridges.delete(connectionId);
      closeWith(other, code, reason);
      if (closed) return;
      closed = true;
      connections.update(connectionId, {
        status: 'closed',
        closedBy: closedByProxy ? 'proxy' : side,
        closeCode: code,
        closeReason: reason.toString('utf8') || undefined,
      });
    };
    client.on('close', onClose('client', upstream));
    upstream.on('close', onClose('server', client));

    client.on('error', (err) => {
      logger.debug(`proxy ${connectionId}: client error: ${err.message}`);
      upstream.terminate();
    });
    upstream.on('error', (err) => {
      logger.debug(`proxy ${connectionId}: server error: ${err.message}`);
      connections.update(connectionId, { error: err.message });
      client.terminate();
    });
  }

  /** Disconnect apps whose target is no longer in `targets`, so nothing keeps recording unseen. */
  closeRemovedTargets(targets: readonly TargetInfo[]): void {
    const ids = new Set(targets.map((t) => t.id));
    for (const bridge of this.bridges.values()) {
      if (!ids.has(bridge.targetId)) bridge.close('Target removed in wslog');
    }
  }

  /** Close every proxied connection (server shutdown). */
  closeAll(): void {
    for (const ws of this.sockets) ws.close(1001, 'wslog shutting down');
    this.sockets.clear();
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/** Mirror a close to the other side, mapping codes that may not be sent on the wire. */
function closeWith(ws: WebSocket, code: number, reason: Buffer): void {
  if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) return;
  if (code === 1006 || code === 1015) return ws.terminate(); // abnormal: no close frame was received
  const sendable = (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005) || (code >= 3000 && code <= 4999);
  if (sendable) ws.close(code, reason.subarray(0, 123));
  else ws.close(1000);
}
