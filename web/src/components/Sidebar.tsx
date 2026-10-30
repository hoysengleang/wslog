import { useMemo, useState } from 'react';
import type { ConnectionInfo, TargetInfo } from '../../../src/shared/protocol';
import { api } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import { proxyUrlFor } from '../hooks/useProxyUrl';
import { describeClose, displayPath, formatCount, shortId, splitTargetUrl } from '../lib/format';
import { actions, showsTraffic, useStore } from '../state/store';
import { CopyButton } from './CopyButton';
import { IconPlus, IconX } from './icons';
import { Sparkline } from './Sparkline';
import { TargetForm } from './TargetForm';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <TargetsList />
      <ConnectionsList />
    </aside>
  );
}

function TargetsList() {
  const targets = useStore((s) => s.targets);
  const selected = useStore((s) => s.filter.targetId);
  const isAdmin = useStore((s) => s.info?.role === 'admin');
  const hasTraffic = useStore(showsTraffic);
  const [adding, setAdding] = useState(false);
  if (!hasTraffic || (!targets.length && !isAdmin)) return null;

  return (
    <section className="side-section">
      <h3 className="side-title">
        Targets
        {isAdmin && (
          <button type="button" className="btn btn-small btn-ghost side-title-action" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <IconPlus width={12} height={12} />
            Add
          </button>
        )}
      </h3>
      {adding && <TargetForm compact autoFocus onAdded={() => setAdding(false)} onCancel={() => setAdding(false)} />}
      <ul className="side-list">
        {targets.length > 1 && (
          <li className={`side-item${!selected ? ' active' : ''}`}>
            <button type="button" className="side-item-main" onClick={() => actions.selectTarget(undefined)}>
              <span>All targets</span>
            </button>
          </li>
        )}
        {targets.map((t) => (
          <TargetRow key={t.id} target={t} active={selected ? t.id === selected : targets.length === 1} selected={selected === t.id} />
        ))}
      </ul>
    </section>
  );
}

function TargetRow({ target, active, selected }: { target: TargetInfo; active: boolean; selected: boolean }) {
  const base = useStore((s) => s.info?.proxyBaseUrl);
  const isAdmin = useStore((s) => s.info?.role === 'admin');
  const openCount = useStore((s) => Object.values(s.connections).filter((c) => c.targetId === target.id && c.status === 'open').length);
  const proxyUrl = proxyUrlFor(base, target) ?? '';
  const { host, path, secure } = splitTargetUrl(target.url);
  const remove = useConfirm(() => {
    api.removeTarget(target.id).catch((err: unknown) => actions.toast((err as Error).message, 'error'));
  });

  return (
    <li className={`side-item target-item${active ? ' active' : ''}`}>
      <div className="target-line">
        <button
          type="button"
          className="side-item-main"
          onClick={() => actions.selectTarget(selected ? undefined : target.id)}
          title={`${target.url}\nShow only traffic through ${proxyUrl}`}
        >
          {/* The path is what tells targets on one host apart, so the host shrinks first. */}
          <span className="target-url mono">
            <span className="target-host">{host}</span>
            {path && <span className="target-path">{path}</span>}
          </span>
          {secure && <span className="badge">wss</span>}
          {target.demo && <span className="badge">demo</span>}
        </button>
        <CopyButton text={proxyUrl} title="Copy proxy URL" className="btn btn-icon" />
        {isAdmin && (
          <button
            type="button"
            className={`btn btn-icon${remove.armed ? ' btn-danger' : ''}`}
            onClick={remove.onClick}
            title={remove.armed ? 'Click again to remove' : 'Remove target'}
            aria-label={remove.armed ? 'Confirm remove target' : 'Remove target'}
          >
            <IconX />
          </button>
        )}
      </div>
      {remove.armed && (
        <p className="target-confirm" role="status">
          Click ✕ again to remove{openCount ? ` and disconnect ${openCount} open connection${openCount === 1 ? '' : 's'}` : ''}.
        </p>
      )}
    </li>
  );
}

const statusRank: Record<ConnectionInfo['status'], number> = { open: 0, connecting: 1, error: 2, closed: 3 };

function ConnectionsList() {
  const connectionsById = useStore((s) => s.connections);
  const rates = useStore((s) => s.rates);
  const selected = useStore((s) => s.filter.connectionId);
  const targetId = useStore((s) => s.filter.targetId);
  const messages = useStore((s) => s.messages);

  const connections = useMemo(
    () =>
      Object.values(connectionsById)
        .filter((c) => !targetId || c.targetId === targetId)
        .sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.openedAt - a.openedAt),
    [connectionsById, targetId],
  );
  const total = useMemo(() => (targetId ? messages.filter((m) => m.targetId === targetId).length : messages.length), [messages, targetId]);
  const openCount = connections.filter((c) => c.status === 'open').length;

  return (
    <section className="side-section side-section-grow">
      <h3 className="side-title">
        Connections <span className="muted">{openCount} open</span>
      </h3>
      <ul className="side-list">
        <li className={`side-item${!selected ? ' active' : ''}`}>
          <button type="button" className="side-item-main" onClick={() => actions.setFilter({ connectionId: undefined })}>
            <span>All connections</span>
            <span className="muted mono">{formatCount(total)}</span>
          </button>
        </li>
        {connections.map((c) => (
          <li key={c.id} className={`side-item conn-item${c.id === selected ? ' active' : ''} conn-${c.status}`}>
            <button
              type="button"
              className="side-item-main"
              onClick={() => actions.setFilter({ connectionId: c.id === selected ? undefined : c.id })}
              title={connectionTitle(c)}
            >
              <span className="conn-line">
                <span className={`conn-dot conn-dot-${c.status}`} />
                <span className="mono">{shortId(c.id)}</span>
                <span className="conn-path mono">{displayPath(c.path)}</span>
              </span>
              <span className="conn-line conn-meta">
                <span className="dir-out">↑{formatCount(c.counts.out)}</span>
                <span className="dir-in">↓{formatCount(c.counts.in)}</span>
                <span className="muted">{connectionStatusText(c)}</span>
                {c.status === 'open' && <Sparkline values={rates[c.id]} />}
              </span>
              {c.error && <span className="conn-error">{c.error}</span>}
            </button>
          </li>
        ))}
      </ul>
      {!connections.length && <p className="side-empty muted">No clients yet. Connect your app to the proxy URL.</p>}
    </section>
  );
}

function connectionStatusText(c: ConnectionInfo): string {
  if (c.status === 'open') return 'open';
  if (c.status === 'connecting') return 'connecting…';
  if (c.status === 'error') return 'failed';
  return c.closeCode ? `closed ${c.closeCode}` : 'closed';
}

function connectionTitle(c: ConnectionInfo): string {
  const lines = [`Connection ${c.id}`, `Client: ${c.clientAddress}`, `Upstream: ${c.upstreamUrl}`];
  if (c.protocol) lines.push(`Subprotocol: ${c.protocol}`);
  if (c.closedBy && c.closeCode) {
    lines.push(`Closed by ${c.closedBy}: ${c.closeCode} ${describeClose(c.closeCode)}${c.closeReason ? ` ("${c.closeReason}")` : ''}`);
  } else if (c.closedBy) {
    lines.push(`Closed by ${c.closedBy}`);
  }
  if (c.error) lines.push(`Error: ${c.error}`);
  return lines.join('\n');
}
