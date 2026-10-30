import { useState } from 'react';
import { api } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import { useProxyUrl } from '../hooks/useProxyUrl';
import { actions, showsTraffic, store, useStore } from '../state/store';
import { CopyButton } from './CopyButton';
import { IconDownload, IconPause, IconPlay, IconShare, IconTrash } from './icons';
import { ShareDialog } from './ShareDialog';

export function TopBar() {
  const status = useStore((s) => s.status);
  const role = useStore((s) => s.info?.role);
  const version = useStore((s) => s.info?.version);
  const paused = useStore((s) => s.paused);
  const heldCount = useStore((s) => s.held.length);
  const hasTraffic = useStore(showsTraffic);
  const proxyUrl = useProxyUrl();
  const targetUrl = useStore((s) => s.targets.find((t) => t.id === s.activeTargetId)?.url);
  const [shareOpen, setShareOpen] = useState(false);
  const isAdmin = role === 'admin';

  const clear = useConfirm(() => {
    api.clear().catch((err: unknown) => actions.toast((err as Error).message, 'error'));
  });
  const exportJson = async () => {
    try {
      await api.exportJson(store.get().filter);
    } catch (err) {
      actions.toast((err as Error).message, 'error');
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className={`status-dot status-${status}`} title={status === 'live' ? 'Live' : 'Reconnecting…'} />
        <span className="brand-name">wslog</span>
        {version && <span className="brand-version">v{version}</span>}
        {role === 'viewer' && <span className="badge">read-only</span>}
      </div>

      {proxyUrl && (
        <div className="proxy-pill" title={`Use this URL in your app instead of ${targetUrl ?? 'the real server'}`}>
          <span className="proxy-label">Proxy</span>
          <code className="mono">{proxyUrl}</code>
          <CopyButton text={proxyUrl} title="Copy proxy URL" className="btn btn-icon" />
        </div>
      )}

      {hasTraffic && <div className="topbar-actions">
        <button type="button" className={`btn ${paused ? 'btn-warn' : ''}`} onClick={actions.togglePause}>
          {paused ? <IconPlay /> : <IconPause />}
          <span>{paused ? `Resume${heldCount ? ` (${heldCount})` : ''}` : 'Pause'}</span>
        </button>
        {isAdmin && (
          <button
            type="button"
            className={`btn${clear.armed ? ' btn-danger' : ''}`}
            onClick={clear.onClick}
            title={clear.armed ? 'Click again to delete every recorded message, for everyone watching' : 'Delete all recorded messages'}
          >
            <IconTrash />
            <span>{clear.armed ? 'Clear for everyone?' : 'Clear'}</span>
          </button>
        )}
        <button type="button" className="btn" onClick={exportJson} title="Download the filtered messages as JSON">
          <IconDownload />
          <span>Export</span>
        </button>
        {isAdmin && (
          <button type="button" className="btn" onClick={() => setShareOpen(true)}>
            <IconShare />
            <span>Share</span>
          </button>
        )}
      </div>}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
    </header>
  );
}

