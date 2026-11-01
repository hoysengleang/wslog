import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname } from 'node:path';
import { PROXY_PREFIX, type TargetInfo } from '../shared/protocol.js';
import type { EventBus } from './events.js';
import { ensurePrivateFile } from './paths.js';
import type { Logger } from './util/logger.js';

export class TargetError extends Error {}

/** Normalize user input into a ws:// or wss:// URL, or throw a friendly error. */
export function normalizeTargetUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new TargetError('Target URL is required');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `ws://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TargetError(`Not a valid URL: ${input}`);
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new TargetError(`Target must be a ws:// or wss:// URL, got ${url.protocol}//`);
  }
  url.hash = '';
  return url.toString();
}

/** Stable id from the URL so the proxy URL survives restarts. */
export function targetIdFor(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 8);
}

export class TargetRegistry {
  private readonly targets = new Map<string, TargetInfo>();

  constructor(private readonly bus: EventBus) {}

  add(input: string, options: { demo?: boolean } = {}): TargetInfo {
    const url = normalizeTargetUrl(input);
    const id = targetIdFor(url);
    const existing = this.targets.get(id);
    if (existing) return existing;
    const target: TargetInfo = { id, url, createdAt: Date.now(), proxyPath: `${PROXY_PREFIX}${id}`, demo: options.demo };
    this.targets.set(id, target);
    this.bus.emit('targets', this.list());
    return target;
  }

  remove(id: string): boolean {
    const removed = this.targets.delete(id);
    if (removed) this.bus.emit('targets', this.list());
    return removed;
  }

  get(id: string): TargetInfo | undefined {
    return this.targets.get(id);
  }

  list(): TargetInfo[] {
    return [...this.targets.values()];
  }
}

/**
 * Can wslog reach the target's host and port right now? Resolves `undefined`
 * if so, otherwise why not, in words. A plain TCP connect, not a WebSocket
 * handshake, so the target never sees a fake client.
 */
export function probeTarget(url: string, timeoutMs = 1500): Promise<string | undefined> {
  const { hostname, port, protocol } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, '');
  const portNumber = Number(port) || (protocol === 'wss:' ? 443 : 80);
  return new Promise((resolve) => {
    const socket = connect({ host, port: portNumber });
    const done = (problem?: string) => {
      socket.destroy();
      resolve(problem);
    };
    socket.setTimeout(timeoutMs, () => done(`${host}:${portNumber} did not answer within ${timeoutMs / 1000}s`));
    socket.once('connect', () => done());
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') done(`nothing is listening on ${host}:${portNumber}`);
      else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') done(`${host} could not be found (DNS)`);
      else done(err.message);
    });
  });
}

/**
 * Re-register targets saved by an earlier run, then keep `file` in sync.
 * Demo targets are skipped: their server gets a new port on every start.
 * The file is private (0600) because target URLs can carry credentials.
 */
export function persistTargets(registry: TargetRegistry, bus: EventBus, file: string, logger: Logger): void {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { targets?: unknown };
    const urls: unknown[] = Array.isArray(saved.targets) ? saved.targets : [];
    urls.forEach((url, i) => {
      try {
        if (typeof url === 'string') registry.add(url);
      } catch {
        // Not the URL itself: it may carry credentials.
        logger.error(`Skipping saved target #${i + 1} in ${file}: not a valid ws:// or wss:// URL`);
      }
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error(`Could not read saved targets from ${file}: ${(err as Error).message}`);
  }

  bus.on('targets', (targets) => {
    const urls = targets.filter((t) => !t.demo).map((t) => t.url);
    try {
      mkdirSync(dirname(file), { recursive: true });
      ensurePrivateFile(file);
      writeFileSync(file, `${JSON.stringify({ targets: urls }, null, 2)}\n`);
    } catch (err) {
      logger.error(`Could not save targets to ${file}: ${(err as Error).message}`);
    }
  });
}

/**
 * Build the upstream URL for a proxied request.
 * `/p/<id>/chat?room=1` on target `ws://host:8080/ws` → `ws://host:8080/ws/chat?room=1`.
 *
 * The app's query string is passed through as sent (repeated keys, encoding,
 * order), so signed URLs keep working. A key the app sends replaces the same
 * key in the target URL.
 */
export function buildUpstreamUrl(target: TargetInfo, requestPath: string): string {
  const url = new URL(target.url);
  const incoming = new URL(requestPath, 'http://proxy.local');
  const suffix = incoming.pathname.slice(target.proxyPath.length);
  if (suffix && suffix !== '/') {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${suffix.replace(/^\//, '')}`;
  }
  const query = incoming.search.slice(1);
  if (query) {
    const sent = new Set(incoming.searchParams.keys());
    const kept = url.search
      .slice(1)
      .split('&')
      .filter((pair) => pair && !sent.has(new URLSearchParams(pair).keys().next().value ?? ''));
    url.search = [...kept, query].join('&');
  }
  return url.toString();
}
