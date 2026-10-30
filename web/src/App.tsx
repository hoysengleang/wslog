import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMatcher, isEmptyFilter } from '../../src/shared/filter';
import { api, ApiError } from './api/client';
import { connectLive } from './api/live';
import { DetailPane } from './components/DetailPane';
import { Onboarding, WaitingForTraffic } from './components/EmptyState';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { TrafficTable } from './components/TrafficTable';
import { formatCount } from './lib/format';
import { withLifecycle } from './lib/rows';
import { actions, applyLiveEvent, showsTraffic, useStore } from './state/store';

export function App() {
  const [denied, setDenied] = useState(false);
  useEffect(() => connectLive({ onEvent: applyLiveEvent, onStatus: actions.setStatus }), []);
  // The live socket cannot report *why* it failed, so probe the API once.
  useEffect(() => {
    api.info().catch((err: unknown) => setDenied(err instanceof ApiError && (err.status === 401 || err.status === 403)));
  }, []);

  const loaded = useStore((s) => Boolean(s.info));
  const hasTraffic = useStore(showsTraffic);
  // On the first screen there is nothing for the sidebar to list, unless an app already tried to connect.
  const showSidebar = useStore((s) => showsTraffic(s) || Object.keys(s.connections).length > 0);
  const status = useStore((s) => s.status);
  const hasSelection = useStore((s) => s.selectedId !== undefined);

  if (denied && !loaded) {
    return (
      <div className="boot boot-denied">
        <h1>Access denied</h1>
        <p className="muted">
          wslog only trusts this machine by default. Open the admin or share link printed in the wslog terminal output (it ends with{' '}
          <code>?token=…</code>).
        </p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="boot">
        <span className={`status-dot status-${status}`} /> {status === 'connecting' ? 'Connecting to wslog…' : 'wslog is not reachable. Retrying…'}
      </div>
    );
  }

  return (
    <div className={`app${status === 'live' ? '' : ' offline'}`}>
      <TopBar />
      {status !== 'live' && <div className="banner">Connection to wslog lost. Reconnecting… What you see may be out of date.</div>}
      <div className={`layout${hasSelection ? ' with-detail' : ''}${showSidebar ? '' : ' no-sidebar'}`}>
        {showSidebar && <Sidebar />}
        <main className="traffic">{hasTraffic ? <Traffic /> : <Onboarding />}</main>
        {hasSelection && <DetailPane />}
      </div>
      <Toasts />
    </div>
  );
}

function Traffic() {
  const messages = useStore((s) => s.messages);
  const connections = useStore((s) => s.connections);
  const filter = useStore((s) => s.filter);
  const paused = useStore((s) => s.paused);
  const heldCount = useStore((s) => s.held.length);
  const [follow, setFollow] = useState(true);
  const onFollowChange = useCallback((f: boolean) => setFollow(f), []);
  const { connectionId, targetId } = filter;
  useEffect(() => {
    if (connectionId || targetId) void actions.loadOlder({ connectionId, targetId });
  }, [connectionId, targetId]);

  const visible = useMemo(() => (isEmptyFilter(filter) ? messages : messages.filter(createMatcher(filter))), [messages, filter]);
  // A target nobody has connected to yet gets the "connect your app" screen, not "no matches".
  const hasTraffic = useMemo(
    () => (filter.targetId ? messages.some((m) => m.targetId === filter.targetId) : messages.length > 0),
    [messages, filter.targetId],
  );
  const rows = useMemo(() => withLifecycle(visible, connections, filter), [visible, connections, filter]);
  // After a clear, follow again so new traffic does not land in a table scrolled to nowhere.
  useEffect(() => {
    if (!hasTraffic) setFollow(true);
  }, [hasTraffic]);

  return (
    <>
      <Toolbar shown={visible.length} follow={follow} onFollow={() => setFollow(true)} />
      {paused && (
        <div className="paused-bar" role="status">
          <span>
            <strong>Paused.</strong>{' '}
            {heldCount ? `${formatCount(heldCount)} new message${heldCount === 1 ? '' : 's'} waiting.` : 'New messages wait here until you resume.'}
          </span>
          <button type="button" className="btn btn-small" onClick={actions.togglePause}>
            Resume
          </button>
        </div>
      )}
      {!hasTraffic ? (
        <WaitingForTraffic />
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="muted">No messages match the current filter.</p>
        </div>
      ) : (
        <TrafficTable rows={rows} follow={follow} onFollowChange={onFollowChange} />
      )}
    </>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
