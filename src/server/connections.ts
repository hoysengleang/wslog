import { randomBytes } from 'node:crypto';
import type { ConnectionInfo, Direction } from '../shared/protocol.js';
import type { EventBus } from './events.js';

/** Keeps the last N closed connections so the sidebar does not grow forever. */
const MAX_CLOSED = 200;

export type NewConnection = Omit<ConnectionInfo, 'id' | 'status' | 'openedAt' | 'counts'>;

/** Tracks proxied client connections and their per-second message rates. */
export class ConnectionRegistry {
  private readonly connections = new Map<string, ConnectionInfo>();
  private ticks = new Map<string, number>();

  constructor(private readonly bus: EventBus) {}

  create(init: NewConnection): ConnectionInfo {
    const connection: ConnectionInfo = {
      ...init,
      id: randomBytes(4).toString('hex'),
      status: 'connecting',
      openedAt: Date.now(),
      counts: { in: 0, out: 0, bytesIn: 0, bytesOut: 0 },
    };
    this.connections.set(connection.id, connection);
    this.bus.emit('connection', connection);
    return connection;
  }

  update(id: string, patch: Partial<ConnectionInfo>): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    Object.assign(connection, patch);
    if (patch.status === 'closed' || patch.status === 'error') {
      connection.closedAt ??= Date.now();
      this.pruneClosed();
    }
    this.bus.emit('connection', connection);
  }

  /** Count a message; connection updates are pushed by the rate tick, not per message. */
  countMessage(id: string, direction: Direction, bytes: number): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    connection.counts[direction]++;
    if (direction === 'in') connection.counts.bytesIn += bytes;
    else connection.counts.bytesOut += bytes;
    this.ticks.set(id, (this.ticks.get(id) ?? 0) + 1);
  }

  /** Returns and resets message counts since the last call. */
  drainRates(): Record<string, number> {
    const rates: Record<string, number> = {};
    for (const connection of this.connections.values()) {
      if (connection.status === 'open') rates[connection.id] = 0;
    }
    for (const [id, n] of this.ticks) rates[id] = n;
    this.ticks = new Map();
    return rates;
  }

  get(id: string): ConnectionInfo | undefined {
    return this.connections.get(id);
  }

  list(): ConnectionInfo[] {
    return [...this.connections.values()];
  }

  /** "Clear" means a fresh start: forget finished connections and zero the counters of open ones. */
  reset(): void {
    for (const c of this.list()) {
      if (c.status === 'closed' || c.status === 'error') this.connections.delete(c.id);
      else c.counts = { in: 0, out: 0, bytesIn: 0, bytesOut: 0 };
    }
    this.ticks = new Map();
  }

  private pruneClosed(): void {
    const closed = this.list().filter((c) => c.status === 'closed' || c.status === 'error');
    for (const c of closed.slice(0, Math.max(0, closed.length - MAX_CLOSED))) this.connections.delete(c.id);
  }
}
