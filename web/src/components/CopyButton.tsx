import { useState } from 'react';
import { actions } from '../state/store';
import { IconCheck, IconCopy } from './icons';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is unavailable on plain-http non-localhost origins.
    const area = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

interface Props {
  text: string | (() => string);
  label?: string;
  className?: string;
  title?: string;
}

export function CopyButton({ text, label, className = 'btn btn-ghost', title = 'Copy' }: Props) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    if (!ok) return actions.toast('Could not copy to clipboard', 'error');
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button type="button" className={className} onClick={onClick} title={title} aria-label={title}>
      {done ? <IconCheck /> : <IconCopy />}
      {label && <span>{done ? 'Copied' : label}</span>}
    </button>
  );
}
