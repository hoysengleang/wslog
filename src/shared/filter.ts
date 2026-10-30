import type { Direction, MessageRecord } from './protocol.js';

/** One filter definition used by the dashboard, the API, and exports. */
export interface MessageFilter {
  /** Case-insensitive substring match on the payload. */
  q?: string;
  direction?: Direction;
  connectionId?: string;
  targetId?: string;
}

export function isEmptyFilter(filter: MessageFilter): boolean {
  return !filter.q && !filter.direction && !filter.connectionId && !filter.targetId;
}

/** Build a predicate once, then apply it to many messages. */
export function createMatcher(filter: MessageFilter): (msg: MessageRecord) => boolean {
  const needle = filter.q?.trim().toLowerCase() ?? '';
  const { direction, connectionId, targetId } = filter;
  return (msg) => {
    if (direction && msg.direction !== direction) return false;
    if (connectionId && msg.connectionId !== connectionId) return false;
    if (targetId && msg.targetId !== targetId) return false;
    if (needle && !msg.payload.toLowerCase().includes(needle)) return false;
    return true;
  };
}

export function filterToSearchParams(filter: MessageFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.direction) params.set('direction', filter.direction);
  if (filter.connectionId) params.set('connectionId', filter.connectionId);
  if (filter.targetId) params.set('targetId', filter.targetId);
  return params;
}

export function filterFromSearchParams(params: URLSearchParams): MessageFilter {
  const direction = params.get('direction');
  return {
    q: params.get('q') ?? undefined,
    direction: direction === 'in' || direction === 'out' ? direction : undefined,
    connectionId: params.get('connectionId') ?? undefined,
    targetId: params.get('targetId') ?? undefined,
  };
}
