import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import WebSocket, { WebSocketServer } from 'ws';
import { createWslog, type CreateWslogOptions, type Wslog } from '../src/index.js';
import type { TargetInfo } from '../src/shared/protocol.js';

/**
 * An upstream that behaves like real servers sometimes do:
 *   /auth/...   rejects the handshake with 401
 *   /quiet/...  says nothing until spoken to
 *   otherwise   sends {"type":"welcome"}, then echoes every message wrapped in JSON
 *               ("die" drops the socket without a close frame, "bye" closes with 4000)
 */
export interface Upstream {
  url: string;
  close(): Promise<void>;
}

export async function startUpstream(): Promise<Upstream> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/auth')) return socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    if (!req.url?.startsWith('/quiet')) ws.send(JSON.stringify({ type: 'welcome' }));
    ws.on('message', (data) => {
      const text = String(data);
      if (text === 'die') return ws.terminate();
      if (text === 'bye') return ws.close(4000, 'bye');
      ws.send(JSON.stringify({ type: 'echo', data: text }));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

/** Your app, connected through the proxy. */
export interface App {
  ws: WebSocket;
  send(text: string): void;
  closed: Promise<{ code: number; reason: string }>;
}

export async function connectApp(url: string): Promise<App> {
  const ws = new WebSocket(url);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('unexpected-response', (_req, res) => reject(new Error(`handshake rejected: ${res.statusCode}`)));
    ws.once('error', reject);
  });
  return { ws, send: (text) => ws.send(text), closed };
}

/** Connect and expect the handshake to fail; resolves with the HTTP status the app saw. */
export function rejectedStatus(url: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => {});
  });
}

export interface TestWslog extends Wslog {
  /** Dashboard URL. 127.0.0.1, not localhost: `localhost` may try IPv6 first and stall. */
  url: string;
  /** ws:// origin for proxy paths, e.g. `${wsBase}/p/unknown`. */
  wsBase: string;
  /** Proxy URL of a target, optionally with a path and query appended. */
  proxyUrl(target: TargetInfo, suffix?: string): string;
}

export async function startTestWslog(options: CreateWslogOptions = {}): Promise<TestWslog> {
  const wslog = await createWslog({ port: 0, logLevel: 'silent', mask: ['token'], ...options });
  const { port } = await wslog.listen();
  const wsBase = `ws://127.0.0.1:${port}`;
  return Object.assign(wslog, {
    url: `http://127.0.0.1:${port}`,
    wsBase,
    proxyUrl: (target: TargetInfo, suffix = '') => `${wsBase}${target.proxyPath}${suffix}`,
  });
}

interface Fixtures {
  upstream: Upstream;
  wslog: TestWslog;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  upstream: async ({}, use) => {
    const upstream = await startUpstream();
    await use(upstream);
    await upstream.close();
  },
  // eslint-disable-next-line no-empty-pattern
  wslog: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'wslog-e2e-'));
    const wslog = await startTestWslog({ targetsFile: join(dir, 'targets.json') });
    await use(wslog);
    await wslog.close();
    rmSync(dir, { recursive: true, force: true });
  },
  // Any error in the browser console fails the test: it is how silent UI bugs surface.
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));
    await use(page);
    const allowed = expectedErrors.get(page) ?? [];
    expect(
      errors.filter((e) => !allowed.some((pattern) => pattern.test(e))),
      'browser console errors',
    ).toEqual([]);
  },
});

const expectedErrors = new WeakMap<Page, RegExp[]>();

/** Declare a console error this test causes on purpose, e.g. the 400 of a rejected form. */
export function allowConsoleError(page: Page, pattern: RegExp): void {
  expectedErrors.set(page, [...(expectedErrors.get(page) ?? []), pattern]);
}

export { expect };
