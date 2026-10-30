import type { LiveEvent } from '../../../src/shared/protocol';
import { liveUrl } from './client';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onStatus(status: LiveStatus): void;
}

/** Keeps a WebSocket to `/api/live` open, reconnecting with backoff. */
export function connectLive(handlers: LiveHandlers): () => void {
  let ws: WebSocket | undefined;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    handlers.onStatus(retry === 0 ? 'connecting' : 'reconnecting');
    ws = new WebSocket(liveUrl());
    ws.onopen = () => {
      retry = 0;
      handlers.onStatus('live');
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        handlers.onEvent(JSON.parse(e.data) as LiveEvent);
      } catch (err) {
        console.error('wslog: bad live event', err);
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      handlers.onStatus('reconnecting');
      const delay = Math.min(5000, 300 * 2 ** retry++);
      timer = setTimeout(open, delay);
    };
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
