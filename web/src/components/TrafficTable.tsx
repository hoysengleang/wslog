import { memo, useCallback, type KeyboardEvent, type ReactNode } from 'react';
import type { MessageRecord } from '../../../src/shared/protocol';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { describeClose, displayPath, formatBytes, formatTime, previewOf, shortId } from '../lib/format';
import { isLifecycle, type LifecycleRow, type TableRow } from '../lib/rows';
import { actions, useStore } from '../state/store';

const ROW_HEIGHT = 26;

interface Props {
  rows: TableRow[];
  follow: boolean;
  onFollowChange(follow: boolean): void;
}

export function TrafficTable({ rows, follow, onFollowChange }: Props) {
  const selectedId = useStore((s) => s.selectedId);
  const query = useStore((s) => s.filter.q?.trim().toLowerCase());
  const { ref, onScroll, start, end, totalHeight, scrollToIndex } = useVirtualRows({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
    follow,
    onFollowChange,
  });

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
      e.preventDefault();
      if (e.key === 'Escape') return actions.select(undefined);
      // Arrow keys move between messages; connection events are skipped.
      const current = rows.findIndex((r) => !isLifecycle(r) && r.id === selectedId);
      // Nothing selected yet: start from the newest message.
      const step = current === -1 || e.key === 'ArrowUp' ? -1 : 1;
      let index = current === -1 ? rows.length - 1 : current + step;
      while (index >= 0 && index < rows.length && isLifecycle(rows[index]!)) index += step;
      const row = rows[index];
      if (!row || isLifecycle(row)) return;
      actions.select(row.id);
      onFollowChange(false);
      scrollToIndex(index);
    },
    [rows, selectedId, scrollToIndex, onFollowChange],
  );

  return (
    <div className="table" role="grid" aria-rowcount={rows.length} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="table-head" role="row">
        <span className="col-id">#</span>
        <span className="col-time">Time</span>
        <span className="col-dir">Dir</span>
        <span className="col-size">Size</span>
        <span className="col-conn">Conn</span>
        <span className="col-preview">Payload</span>
      </div>
      <div className="table-body" ref={ref} onScroll={onScroll}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {rows.slice(start, end).map((row, i) =>
            isLifecycle(row) ? (
              <EventRow key={row.key} row={row} top={(start + i) * ROW_HEIGHT} />
            ) : (
              <Row key={row.id} msg={row} top={(start + i) * ROW_HEIGHT} selected={row.id === selectedId} query={query} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

const Row = memo(function Row({ msg, top, selected, query }: { msg: MessageRecord; top: number; selected: boolean; query?: string }) {
  return (
    <div
      role="row"
      aria-selected={selected}
      className={`table-row dir-row-${msg.direction}${selected ? ' selected' : ''}`}
      style={{ transform: `translateY(${top}px)`, height: ROW_HEIGHT }}
      onClick={() => actions.select(selected ? undefined : msg.id)}
    >
      <span className="col-id mono muted">{msg.id}</span>
      <span className="col-time mono">{formatTime(msg.time)}</span>
      <span className={`col-dir dir-${msg.direction}`} title={msg.direction === 'out' ? 'client → server' : 'server → client'}>
        {msg.direction === 'out' ? '↑ out' : '↓ in'}
      </span>
      <span className="col-size mono muted">{formatBytes(msg.size)}</span>
      <span className="col-conn mono muted">{shortId(msg.connectionId)}</span>
      <span className={`col-preview mono${msg.kind === 'binary' ? ' muted' : ''}`}>
        {msg.kind === 'text' ? highlight(previewOf(msg), query) : previewOf(msg)}
      </span>
    </div>
  );
});

/** Wrap every case-insensitive match of the search in <mark>. `query` is already lowercase. */
function highlight(text: string, query: string | undefined): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return parts;
}

const EventRow = memo(function EventRow({ row, top }: { row: LifecycleRow; top: number }) {
  const text = eventText(row);
  return (
    <div role="row" className={`table-row event-row event-${row.event}`} style={{ transform: `translateY(${top}px)`, height: ROW_HEIGHT }} title={text}>
      <span className="col-id" />
      <span className="col-time mono">{formatTime(row.time)}</span>
      <span className="col-dir">{row.event === 'open' ? '●' : '✕'}</span>
      <span className="col-size" />
      <span className="col-conn mono muted">{shortId(row.connection.id)}</span>
      <span className="col-preview">{text}</span>
    </div>
  );
});

function eventText({ event, connection: c }: LifecycleRow): string {
  if (event === 'open') return `connected ${displayPath(c.path)}`;
  if (event === 'fail') return `failed: ${c.error ?? 'unknown error'}`;
  const code = c.closeCode ? ` ${c.closeCode} · ${describeClose(c.closeCode)}` : '';
  const reason = c.closeReason ? ` "${c.closeReason}"` : '';
  return `closed${code}${reason}${c.closedBy ? ` (by ${c.closedBy})` : ''}`;
}
