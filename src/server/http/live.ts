import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { ConnectionInfo, LiveEvent, MessageRecord, Role } from '../../shared/protocol.js';
import { appInfo, baseInfo, publicTargets, type WslogContext } from '../context.js';
import { toPartial } from './api.js';

const FLUSH_MS = 50;
const RATE_MS = 1000;
const HELLO_MESSAGES = 1000;
/** Stop streaming to a dashboard that cannot keep up; resync it once it drains. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

interface Client {
  ws: WebSocket;
  role: Role;
  req: IncomingMessage;
  lagging: boolean;
}

/**
 * Streams wslog events to dashboards over `/api/live`.
 * Messages and connection updates are batched every 50 ms so a busy
 * proxy does not flood the browser with tiny frames.
 */
export class LiveHub {
  private readonly wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  private readonly clients = new Set<Client>();
  private pendingMessages: MessageRecord[] = [];
  private readonly pendingConnections = new Map<string, ConnectionInfo>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly ctx: WslogContext) {
    const { bus } = ctx;
    this.unsubscribe.push(
      bus.on('message', (m) => this.pendingMessages.push(toPartial(m))),
      bus.on('connection', (c) => this.pendingConnections.set(c.id, { ...c, counts: { ...c.counts } })),
      bus.on('targets', (targets) => this.broadcast({ type: 'targets', targets: publicTargets(ctx, targets) })),
      bus.on('cleared', () => {
        this.pendingMessages = [];
        this.pendingConnections.clear();
        this.broadcast({ type: 'cleared', connections: ctx.connections.list() });
      }),
      // Per client: the proxy base URL depends on how each dashboard reached wslog.
      bus.on('info', () => {
        for (const client of this.clients) this.send(client, { type: 'info', info: baseInfo(ctx, client.req) });
      }),
    );
    this.timers.push(setInterval(() => this.flush(), FLUSH_MS), setInterval(() => this.tickRates(), RATE_MS));
    for (const t of this.timers) t.unref();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: Role): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // Batched messages are already in the store, so they will be in the hello
      // snapshot. Send them to existing dashboards now, before this one joins,
      // or the next flush would deliver them to it a second time.
      this.flush();
      const client: Client = { ws, role, req, lagging: false };
      this.clients.add(client);
      ws.on('close', () => this.clients.delete(client));
      ws.on('error', () => ws.terminate());
      this.sendHello(client);
    });
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    for (const off of this.unsubscribe) off();
    for (const { ws } of this.clients) ws.close(1001, 'wslog shutting down');
    this.clients.clear();
  }

  private sendHello(client: Client): void {
    const { ctx } = this;
    this.send(client, {
      type: 'hello',
      info: appInfo(ctx, client.role, client.req),
      targets: publicTargets(ctx),
      connections: ctx.connections.list(),
      messages: ctx.store.query({ limit: HELLO_MESSAGES }).map(toPartial),
    });
  }

  private flush(): void {
    if (this.pendingConnections.size) {
      for (const connection of this.pendingConnections.values()) this.broadcast({ type: 'connection', connection });
      this.pendingConnections.clear();
    }
    if (this.pendingMessages.length) {
      const items = this.pendingMessages;
      this.pendingMessages = [];
      this.broadcast({ type: 'messages', items });
    }
  }

  private tickRates(): void {
    const rates = this.ctx.connections.drainRates();
    // Counters change without events; push fresh totals for active connections.
    for (const id of Object.keys(rates)) {
      const connection = this.ctx.connections.get(id);
      if (connection && rates[id]) this.pendingConnections.set(id, { ...connection, counts: { ...connection.counts } });
    }
    this.broadcast({ type: 'rates', time: Date.now(), rates });
  }

  private broadcast(event: LiveEvent): void {
    if (!this.clients.size) return;
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        client.lagging = true;
        continue;
      }
      if (client.lagging) {
        client.lagging = false;
        this.sendHello(client);
        continue;
      }
      client.ws.send(data);
    }
  }

  private send(client: Client, event: LiveEvent): void {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(event));
  }
}
