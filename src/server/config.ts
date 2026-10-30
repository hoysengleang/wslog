import { randomBytes } from 'node:crypto';

export interface WslogConfig {
  /** Dashboard + proxy port. `0` picks a free port. */
  port: number;
  /** Bind address. Loopback by default; `0.0.0.0` only on trusted networks. */
  host: string;
  /**
   * Address people use to reach wslog, for the links it prints and the share
   * link, e.g. `http://localhost:8080` in Docker. Default: derived from host and port.
   */
  publicUrl?: string;
  /** Field names to mask before anything is stored or shown. */
  mask: string[];
  /** Storage limit; oldest messages are dropped first. */
  maxMessages: number;
  /** Max bytes of payload kept per message; longer payloads are truncated. */
  maxPayloadBytes: number;
  /** `memory`, a `.jsonl` file path, or a `.db` / `.sqlite` file path. */
  store: string;
  /** Token for the read-only share link. */
  shareToken: string;
  /** Token for full access from non-loopback addresses. */
  adminToken: string;
  /** Target URLs to register on startup. */
  targets: string[];
  /**
   * JSON file that remembers targets across restarts, so proxy URLs in your app
   * keep working. The CLI sets one; unset keeps targets in memory only.
   */
  targetsFile?: string;
  demo: boolean;
  /** Path to the built dashboard. Defaults to `dist/web` inside the package. */
  webRoot?: string;
  logLevel: 'silent' | 'error' | 'info' | 'debug';
}

export const DEFAULT_CONFIG = {
  port: 4000,
  host: '127.0.0.1',
  mask: [],
  maxMessages: 10_000,
  maxPayloadBytes: 1024 * 1024,
  store: 'memory',
  targets: [],
  demo: false,
  logLevel: 'info',
} satisfies Omit<WslogConfig, 'shareToken' | 'adminToken'>;

/** Fields masked automatically in demo mode so the feature is visible. */
export const DEMO_MASK_FIELDS = ['token', 'password'];

export function generateToken(): string {
  return randomBytes(18).toString('base64url');
}

export function resolveConfig(input: Partial<WslogConfig> = {}): WslogConfig {
  const config: WslogConfig = {
    ...DEFAULT_CONFIG,
    shareToken: generateToken(),
    adminToken: generateToken(),
    ...stripUndefined(input),
  };
  config.mask = [...new Set(config.mask.map((f) => f.trim()).filter(Boolean))];
  if (config.demo && config.mask.length === 0) config.mask = [...DEMO_MASK_FIELDS];

  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}`);
  }
  if (!Number.isInteger(config.maxMessages) || config.maxMessages < 1) {
    throw new Error(`--max-messages must be a positive integer, got ${config.maxMessages}`);
  }
  if (!Number.isInteger(config.maxPayloadBytes) || config.maxPayloadBytes < 1) {
    throw new Error(`--max-payload must be a positive integer, got ${config.maxPayloadBytes}`);
  }
  config.publicUrl = config.publicUrl?.trim() ? normalizePublicUrl(config.publicUrl) : undefined;
  return config;
}

function normalizePublicUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`--public-url must be a URL like http://localhost:4000, got "${input}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--public-url must start with http:// or https://, got "${input}"`);
  }
  return url.origin;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost' || host.startsWith('127.');
}

export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '';
}
