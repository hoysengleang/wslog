import { useMemo, useState } from 'react';
import type { ConnectionFailure, ConnectionInfo } from '../../../src/shared/protocol';
import { api } from '../api/client';
import { useProxyUrl } from '../hooks/useProxyUrl';
import { actions, useStore } from '../state/store';
import { CopyButton } from './CopyButton';
import { TargetForm } from './TargetForm';

/** The newest connection in the selected target (or all), if any. */
function useLatestConnection(): ConnectionInfo | undefined {
  const connections = useStore((s) => s.connections);
  const targetId = useStore((s) => s.filter.targetId);
  return useMemo(() => {
    let latest: ConnectionInfo | undefined;
    for (const c of Object.values(connections)) {
      if (targetId && c.targetId !== targetId) continue;
      if (!latest || c.openedAt > latest.openedAt) latest = c;
    }
    return latest;
  }, [connections, targetId]);
}

const FAILURES: Record<ConnectionFailure, { title: string; hint: string }> = {
  unreachable: {
    title: 'Your app connected, but wslog could not reach your server',
    hint: 'Is the server running, and are the host and port right? If wslog runs in Docker, localhost is the container itself: use host.docker.internal.',
  },
  rejected: {
    title: 'Your server refused the connection',
    hint: "wslog passes your app's headers, cookies, and subprotocol through unchanged, so check the credentials and path your app sends.",
  },
  'no-target': {
    title: 'Your app used a proxy URL wslog does not know',
    hint: 'Its target was removed, or wslog was started without remembering it. Paste the server URL again; the proxy URL will be the same.',
  },
};

/** Why the newest connection failed, in words, with what to check next. */
function ConnectionProblem({ connection }: { connection: ConnectionInfo }) {
  const base = useStore((s) => s.info?.proxyBaseUrl ?? '');
  const { title, hint } = connection.failure ? FAILURES[connection.failure] : { title: 'The connection failed', hint: '' };
  const detail = connection.failure === 'no-target' ? `${base}${connection.path}` : connection.error;
  return (
    <div className="problem" role="alert">
      <h2>{title}</h2>
      {detail && <code className="mono">{detail}</code>}
      {hint && <p>{hint}</p>}
    </div>
  );
}

/** Shown when no target exists yet: paste a URL or start the demo. */
export function Onboarding() {
  const isAdmin = useStore((s) => s.info?.role === 'admin');
  const latest = useLatestConnection();
  const [starting, setStarting] = useState(false);

  const startDemo = async () => {
    setStarting(true);
    try {
      const target = await api.startDemo();
      actions.setActiveTarget(target.id);
    } catch (err) {
      actions.toast((err as Error).message, 'error');
    } finally {
      setStarting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="empty">
        <h1>Waiting for traffic</h1>
        <p className="muted">This is a read-only live view. Messages appear here when the owner adds a target and an app connects.</p>
      </div>
    );
  }

  return (
    <div className="empty">
      {latest?.status === 'error' && <ConnectionProblem connection={latest} />}
      <h1>Watch every WebSocket message</h1>
      <p className="muted">Paste your WebSocket server URL. wslog gives you a proxy URL to use in your app instead.</p>
      <TargetForm large autoFocus />
      <ol className="steps">
        <li>Paste the <code>ws://</code> or <code>wss://</code> URL your app connects to.</li>
        <li>Copy the proxy URL and use it in your app.</li>
        <li>Watch messages arrive live. No code changes.</li>
      </ol>
      <div className="empty-divider">
        <span>or</span>
      </div>
      <button type="button" className="btn" onClick={startDemo} disabled={starting}>
        {starting ? 'Starting demo…' : 'Try the demo chat server'}
      </button>
    </div>
  );
}

/** Shown when a target exists but nothing has been recorded yet. */
export function WaitingForTraffic() {
  const proxyUrl = useProxyUrl();
  const latest = useLatestConnection();
  const snippet = `const ws = new WebSocket("${proxyUrl ?? ''}");`;

  if (latest?.status === 'open') {
    return (
      <div className="empty">
        <h1>Connected. Waiting for the first message</h1>
        <p className="muted">Your app is connected through wslog. Messages appear here as soon as either side sends one.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      {latest?.status === 'error' && <ConnectionProblem connection={latest} />}
      <h1>Waiting for your app to connect</h1>
      <p className="muted">Point your app at the proxy URL. Path and query are passed through to your server.</p>
      {proxyUrl && (
        <div className="code-block">
          <code className="mono">{proxyUrl}</code>
          <CopyButton text={proxyUrl} label="Copy" className="btn btn-small" />
        </div>
      )}
      <div className="code-block">
        <code className="mono">{snippet}</code>
        <CopyButton text={snippet} className="btn btn-icon" />
      </div>
    </div>
  );
}
