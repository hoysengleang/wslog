import { filterToSearchParams, type MessageFilter } from '../../../src/shared/filter';
import { LIVE_PATH, type AddedTarget, type AppInfo, type MessageRecord, type TargetInfo } from '../../../src/shared/protocol';

const TOKEN_KEY = 'wslog.token';

/**
 * A `?token=` in the page URL (share or admin link) is moved to
 * sessionStorage and removed from the address bar so it does not end up
 * in screenshots or history.
 */
function initToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // Storage blocked; keep the token in memory only.
    }
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.toString());
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

const token = initToken();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('x-wslog-token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  info: () => request<AppInfo>('/api/info'),
  addTarget: (url: string) => request<AddedTarget>('/api/targets', { method: 'POST', body: JSON.stringify({ url }) }),
  removeTarget: (id: string) => request<void>(`/api/targets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  message: (id: number) => request<MessageRecord>(`/api/messages/${id}`),
  /** Up to `limit` of the newest matching messages with an id below `beforeId`, oldest first. */
  messagesBefore(filter: MessageFilter, beforeId: number, limit = 5000) {
    const params = filterToSearchParams(filter);
    params.set('beforeId', String(beforeId));
    params.set('limit', String(limit));
    return request<MessageRecord[]>(`/api/messages?${params.toString()}`);
  },
  clear: () => request<void>('/api/messages', { method: 'DELETE' }),
  share: () => request<{ url: string; networkReachable: boolean }>('/api/share'),
  startDemo: () => request<TargetInfo>('/api/demo', { method: 'POST' }),

  async exportJson(filter: MessageFilter): Promise<void> {
    const headers: HeadersInit = token ? { 'x-wslog-token': token } : {};
    const res = await fetch(`/api/export?${filterToSearchParams(filter).toString()}`, { headers });
    if (!res.ok) throw new ApiError(res.status, 'Export failed');
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'wslog-export.json';
    const href = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  },
};

export function liveUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${window.location.host}${LIVE_PATH}${query}`;
}
