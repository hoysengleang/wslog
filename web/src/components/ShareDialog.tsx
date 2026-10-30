import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { CopyButton } from './CopyButton';
import { IconX } from './icons';

export function ShareDialog({ onClose }: { onClose(): void }) {
  const [share, setShare] = useState<{ url: string; networkReachable: boolean }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.share().then(setShare, (err: Error) => setError(err.message));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="share-title">Share a read-only live view</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="muted">Anyone with this link can watch traffic live and export it, but cannot add targets or clear data.</p>
        {error && <div className="form-error">{error}</div>}
        {share && (
          <>
            <div className="share-row">
              <input className="input mono" readOnly value={share.url} onFocus={(e) => e.target.select()} />
              <CopyButton text={share.url} label="Copy" className="btn btn-primary" />
            </div>
            {!share.networkReachable && (
              <p className="notice">
                wslog is bound to localhost, so this link only works on this machine. Restart with{' '}
                <code>--host 0.0.0.0</code> on a trusted network to share it with teammates.
              </p>
            )}
            <p className="muted small">The link contains a token. Treat it like a password: traffic can include personal data.</p>
          </>
        )}
      </div>
    </div>
  );
}
