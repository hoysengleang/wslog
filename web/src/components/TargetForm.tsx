import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { actions } from '../state/store';

interface Props {
  large?: boolean;
  /** Sidebar version: full width, short button label. */
  compact?: boolean;
  autoFocus?: boolean;
  onAdded?(): void;
  onCancel?(): void;
}

/** Paste a ws:// or wss:// URL, get a proxy URL. */
export function TargetForm({ large, compact, autoFocus, onAdded, onCancel }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const target = await api.addTarget(url);
      actions.selectTarget(target.id);
      setUrl('');
      onAdded?.();
      if (target.unreachable) actions.toast(`Added, but ${target.unreachable} right now. Is your server running?`, 'error');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`target-form${large ? ' target-form-large' : ''}${compact ? ' target-form-compact' : ''}`} onSubmit={submit}>
      <input
        className="input mono"
        type="text"
        placeholder="ws://localhost:8080/socket"
        aria-label="Target WebSocket URL"
        value={url}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(undefined);
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
      />
      <button className="btn btn-primary" type="submit" disabled={busy || !url.trim()}>
        {busy ? 'Adding…' : compact ? 'Add' : 'Get proxy URL'}
      </button>
      {error && <div className="form-error">{error}</div>}
    </form>
  );
}
