import type { MessageFilter } from '../../../src/shared/filter';
import type { ConnectionInfo, MessageRecord } from '../../../src/shared/protocol';

/** A connection opening, closing, or failing, shown between the messages. */
export interface LifecycleRow {
  kind: 'lifecycle';
  key: string;
  time: number;
  event: 'open' | 'close' | 'fail';
  connection: ConnectionInfo;
}

export type TableRow = MessageRecord | LifecycleRow;

export const isLifecycle = (row: TableRow): row is LifecycleRow => row.kind === 'lifecycle';

/**
 * Interleave connection events with messages by time, so a drop (close 1006)
 * shows up where it happened instead of only in the sidebar. Skipped while
 * searching or filtering by direction: those views are about payloads.
 */
export function withLifecycle(messages: MessageRecord[], connections: Record<string, ConnectionInfo>, filter: MessageFilter): TableRow[] {
  const first = messages[0];
  if (!first || filter.q || filter.direction) return messages;

  // Connections with loaded messages get all their events; others only those
  // inside the loaded window, so hundreds of old closed connections stay out.
  const withMessages = new Set<string>();
  for (const m of messages) withMessages.add(m.connectionId);

  const events: LifecycleRow[] = [];
  const add = (connection: ConnectionInfo, event: LifecycleRow['event'], time: number) => {
    if (withMessages.has(connection.id) || time >= first.time) events.push({ kind: 'lifecycle', key: `${connection.id}:${event}`, time, event, connection });
  };
  for (const c of Object.values(connections)) {
    if (filter.targetId && c.targetId !== filter.targetId) continue;
    if (filter.connectionId && c.id !== filter.connectionId) continue;
    if (c.status === 'error') {
      add(c, 'fail', c.closedAt ?? c.openedAt);
      continue;
    }
    add(c, 'open', c.openedAt);
    if (c.status === 'closed') add(c, 'close', c.closedAt ?? c.openedAt);
  }
  if (!events.length) return messages;
  events.sort((a, b) => a.time - b.time);

  const rows: TableRow[] = [];
  let i = 0;
  for (const msg of messages) {
    // At the same millisecond an open goes before the message, a close after it.
    for (let e = events[i]; e && (e.time < msg.time || (e.time === msg.time && e.event === 'open')); e = events[++i]) rows.push(e);
    rows.push(msg);
  }
  while (i < events.length) rows.push(events[i++]!);
  return rows;
}
