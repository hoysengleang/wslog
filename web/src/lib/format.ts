import type { MessageRecord } from '../../../src/shared/protocol';

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatDateTime(ms: number): string {
  return `${new Date(ms).toLocaleDateString()} ${formatTime(ms)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** One-line preview for the traffic table. */
export function previewOf(msg: MessageRecord): string {
  if (msg.kind === 'binary') return `‹binary ${formatBytes(msg.size)}›`;
  return msg.payload.length > 300 ? msg.payload.slice(0, 300) : msg.payload;
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false };

export function tryParseJson(text: string): ParsedJson {
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Classic 16-bytes-per-line hex dump. */
export function hexDump(bytes: Uint8Array, maxBytes = 64 * 1024): string {
  const lines: string[] = [];
  const end = Math.min(bytes.length, maxBytes);
  for (let offset = 0; offset < end; offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(offset + 16, end));
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > end) lines.push(`… ${bytes.length - end} more bytes`);
  return lines.join('\n');
}

export function shortId(id: string): string {
  return id.slice(0, 6);
}

/** `/p/abc123/chat?room=1` → `/chat?room=1`: the proxy prefix is the same for every connection. */
export function displayPath(path: string): string {
  return path.replace(/^\/p\/[^/?]+/, '') || '/';
}

const CLOSE_CODES: Record<number, string> = {
  1000: 'normal',
  1001: 'going away',
  1002: 'protocol error',
  1003: 'unsupported data',
  1005: 'no status code',
  1006: 'dropped without a close frame',
  1007: 'invalid payload',
  1008: 'policy violation',
  1009: 'message too big',
  1010: 'missing extension',
  1011: 'server error',
  1012: 'service restart',
  1013: 'try again later',
  1014: 'bad gateway',
  1015: 'TLS handshake failed',
};

/** What a WebSocket close code means, in words. */
export function describeClose(code: number): string {
  if (CLOSE_CODES[code]) return CLOSE_CODES[code];
  if (code >= 4000 && code <= 4999) return 'app-defined';
  if (code >= 3000 && code <= 3999) return 'library-defined';
  return 'unknown';
}

/** `wss://api.example.com:443/socket?x=1` → host `api.example.com:443`, path `/socket?x=1`. */
export function splitTargetUrl(url: string): { host: string; path: string; secure: boolean } {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return { host: u.host, path: path === '/' ? '' : path, secure: u.protocol === 'wss:' };
  } catch {
    return { host: url, path: '', secure: false };
  }
}
