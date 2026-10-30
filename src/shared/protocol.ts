/**
 * Wire types shared by the server and the dashboard.
 * Anything that crosses the HTTP / live-stream boundary is defined here.
 */

/** `out` = client → server (sent by your app), `in` = server → client. */
export type Direction = 'in' | 'out';

export type PayloadKind = 'text' | 'binary';

export interface MessageRecord {
  /** Monotonic id, unique per wslog data store. */
  id: number;
  connectionId: string;
  targetId: string;
  direction: Direction;
  /** Epoch milliseconds. */
  time: number;
  /** Size of the original frame in bytes (before masking or truncation). */
  size: number;
  kind: PayloadKind;
  /** UTF-8 text for text frames, base64 for binary frames. Already masked. */
  payload: string;
  /** The stored payload was cut at the configured `maxPayloadBytes`. */
  truncated: boolean;
  /**
   * Only on records sent to the dashboard: the payload was shortened for
   * transport; fetch `GET /api/messages/:id` for the stored version.
   */
  partial?: boolean;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

/**
 * Why a connection never opened: the server could not be reached, it refused
 * the handshake, or the app used a proxy URL that has no target (removed, or
 * a wslog that does not remember it).
 */
export type ConnectionFailure = 'unreachable' | 'rejected' | 'no-target';

export interface ConnectionInfo {
  id: string;
  targetId: string;
  /** Path + query the client requested on the proxy (masked). */
  path: string;
  /** Upstream URL the proxy dialed (masked). */
  upstreamUrl: string;
  clientAddress: string;
  userAgent?: string;
  protocol?: string;
  status: ConnectionStatus;
  openedAt: number;
  closedAt?: number;
  closeCode?: number;
  closeReason?: string;
  /** Which side closed first. */
  closedBy?: 'client' | 'server' | 'proxy';
  error?: string;
  /** Set when `status` is `error` because the connection never opened. */
  failure?: ConnectionFailure;
  counts: { in: number; out: number; bytesIn: number; bytesOut: number };
}

export interface TargetInfo {
  /** Stable id derived from the URL, so the proxy URL survives restarts. */
  id: string;
  url: string;
  createdAt: number;
  /** e.g. `/p/3f9a1c2b` — combine with `AppInfo.proxyBaseUrl`. */
  proxyPath: string;
  demo?: boolean;
}

/** `POST /api/targets` answer. */
export interface AddedTarget extends TargetInfo {
  /** Why wslog could not reach the target when it was added, if it could not. */
  unreachable?: string;
}

export type Role = 'admin' | 'viewer';

export interface AppInfo {
  name: 'wslog';
  version: string;
  role: Role;
  /** e.g. `ws://127.0.0.1:4000` */
  proxyBaseUrl: string;
  maskFields: string[];
  maxMessages: number;
  storage: string;
  demoRunning: boolean;
}

/** Events pushed to dashboards over `/api/live`. */
export type LiveEvent =
  | {
      type: 'hello';
      info: AppInfo;
      targets: TargetInfo[];
      connections: ConnectionInfo[];
      messages: MessageRecord[];
    }
  | { type: 'messages'; items: MessageRecord[] }
  | { type: 'connection'; connection: ConnectionInfo }
  | { type: 'targets'; targets: TargetInfo[] }
  | { type: 'rates'; time: number; rates: Record<string, number> }
  /** Messages were deleted; `connections` is what remains (open ones, counters reset). */
  | { type: 'cleared'; connections: ConnectionInfo[] }
  | { type: 'info'; info: Omit<AppInfo, 'role'> };

export interface ApiError {
  error: string;
}

/** Max characters of payload sent to the dashboard per message in lists/live. */
export const LIVE_PAYLOAD_LIMIT = 4096;

export const PROXY_PREFIX = '/p/';
export const LIVE_PATH = '/api/live';
