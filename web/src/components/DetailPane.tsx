import { useEffect, useMemo, useState } from 'react';
import type { MessageRecord } from '../../../src/shared/protocol';
import { api } from '../api/client';
import { base64ToBytes, formatBytes, formatDateTime, hexDump, tryParseJson } from '../lib/format';
import { actions, useStore } from '../state/store';
import { CopyButton } from './CopyButton';
import { IconX } from './icons';
import { JsonTree } from './JsonTree';

type View = 'tree' | 'raw' | 'hex' | 'base64';

const WIDTH_KEY = 'wslog.detailWidth';

/** The pane width lives in a CSS variable that the layout grid reads; clamped so the table always keeps some room. */
function setDetailWidth(px: number | undefined): void {
  const root = document.documentElement.style;
  if (px === undefined) root.removeProperty('--detail-width');
  else root.setProperty('--detail-width', `clamp(280px, ${Math.round(px)}px, 65%)`);
}

function savedWidth(): number | undefined {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || undefined;
  } catch {
    return undefined;
  }
}

function saveWidth(px: number | undefined): void {
  try {
    if (px === undefined) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(Math.round(px)));
  } catch {
    // Storage blocked; the width just is not remembered.
  }
}

/** Drag (or ←/→) the pane's left edge to resize it; double-click resets. */
function ResizeHandle() {
  useEffect(() => setDetailWidth(savedWidth()), []);
  const paneWidth = (handle: HTMLElement) => handle.parentElement?.getBoundingClientRect().width ?? 0;
  const apply = (px: number | undefined) => {
    setDetailWidth(px);
    saveWidth(px);
  };

  return (
    <div
      className="detail-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize message details"
      tabIndex={0}
      onDoubleClick={() => apply(undefined)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        apply(paneWidth(e.currentTarget) + (e.key === 'ArrowLeft' ? 32 : -32));
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = paneWidth(e.currentTarget);
        let width = startWidth;
        const onMove = (ev: PointerEvent) => {
          width = startWidth + startX - ev.clientX;
          setDetailWidth(width);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          document.body.classList.remove('resizing');
          saveWidth(width);
        };
        document.body.classList.add('resizing');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
    />
  );
}

export function DetailPane() {
  const selectedId = useStore((s) => s.selectedId);
  const summary = useStore((s) => (s.selectedId === undefined ? undefined : s.messages.find((m) => m.id === s.selectedId)));
  const connection = useStore((s) => (summary ? s.connections[summary.connectionId] : undefined));
  const message = useFullMessage(summary);

  if (selectedId === undefined || !summary) {
    return (
      <aside className="detail detail-empty">
        <p className="muted">This message is no longer in view (cleared or dropped by the storage limit).</p>
      </aside>
    );
  }

  return (
    <aside className="detail">
      <ResizeHandle />
      <div className="detail-head">
        <span className={`dir-badge dir-${summary.direction}`}>{summary.direction === 'out' ? '↑ out' : '↓ in'}</span>
        <span className="mono">#{summary.id}</span>
        <span className="muted">{summary.direction === 'out' ? 'client → server' : 'server → client'}</span>
        <button type="button" className="btn btn-icon detail-close" onClick={() => actions.select(undefined)} aria-label="Close">
          <IconX />
        </button>
      </div>
      <dl className="detail-meta">
        <dt>Time</dt>
        <dd className="mono">{formatDateTime(summary.time)}</dd>
        <dt>Size</dt>
        <dd className="mono">
          {formatBytes(summary.size)} · {summary.kind}
        </dd>
        <dt>Connection</dt>
        <dd className="mono" title={connection?.upstreamUrl}>
          {summary.connectionId}
          {connection && <span className="muted"> {connection.path}</span>}
        </dd>
      </dl>
      {message.state === 'loading' && <p className="muted detail-body">Loading full payload…</p>}
      {message.state === 'error' && <p className="form-error detail-body">{message.error}</p>}
      {message.state === 'ready' && <PayloadView msg={message.msg} />}
    </aside>
  );
}

type FullMessage = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; msg: MessageRecord };

/** Lists carry shortened payloads; fetch the stored record when needed. */
function useFullMessage(summary: MessageRecord | undefined): FullMessage {
  const [fetched, setFetched] = useState<{ id: number; result: FullMessage }>();
  const needsFetch = Boolean(summary?.partial);
  const id = summary?.id;

  useEffect(() => {
    if (!needsFetch || id === undefined) return;
    let cancelled = false;
    api.message(id).then(
      (msg) => !cancelled && setFetched({ id, result: { state: 'ready', msg } }),
      (err: Error) => !cancelled && setFetched({ id, result: { state: 'error', error: err.message } }),
    );
    return () => {
      cancelled = true;
    };
  }, [id, needsFetch]);

  if (!summary) return { state: 'loading' };
  if (!needsFetch) return { state: 'ready', msg: summary };
  return fetched?.id === summary.id ? fetched.result : { state: 'loading' };
}

function PayloadView({ msg }: { msg: MessageRecord }) {
  const json = useMemo(() => (msg.kind === 'text' ? tryParseJson(msg.payload) : { ok: false as const }), [msg]);
  const views: View[] = msg.kind === 'binary' ? ['hex', 'base64'] : json.ok ? ['tree', 'raw'] : ['raw'];
  const [preferred, setPreferred] = useState<View>('tree');
  const view = views.includes(preferred) ? preferred : views[0]!;

  const copyValue = () => (json.ok ? JSON.stringify(json.value, null, 2) : msg.payload);

  return (
    <div className="detail-body">
      <div className="detail-tabs">
        <div className="segmented">
          {views.map((v) => (
            <button key={v} type="button" className={v === view ? 'active' : ''} onClick={() => setPreferred(v)}>
              {v === 'tree' ? 'Tree' : v === 'raw' ? 'Raw' : v === 'hex' ? 'Hex' : 'Base64'}
            </button>
          ))}
        </div>
        <CopyButton text={copyValue} label="Copy" className="btn btn-small" />
      </div>
      {msg.truncated && <p className="notice">Payload was truncated when stored. Raise --max-payload to keep more.</p>}
      <div className="payload">
        {view === 'tree' && json.ok && <JsonTree value={json.value} />}
        {view === 'raw' && <pre className="mono raw">{msg.payload}</pre>}
        {view === 'hex' && <pre className="mono raw hex">{hexDump(base64ToBytes(msg.payload))}</pre>}
        {view === 'base64' && <pre className="mono raw">{msg.payload}</pre>}
      </div>
    </div>
  );
}
