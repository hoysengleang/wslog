import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer, type ServerOptions } from 'ws';
import { createWslog, type CreateWslogOptions, type Wslog } from '../../src/server/app.js';

/** An upstream server that echoes every frame back, prefixed with "echo:" for text. */
export async function startEchoServer(options: ServerOptions = {}): Promise<{ url: string; wss: WebSocketServer; close(): Promise<void> }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, ...options });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => ws.send(isBinary ? (data as Buffer) : `echo:${String(data)}`, { binary: isBinary }));
  });
  const { port } = wss.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    wss,
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => resolve());
      }),
  };
}

export async function startWslog(options: CreateWslogOptions = {}): Promise<Wslog & { base: string }> {
  const wslog = await createWslog({ port: 0, logLevel: 'silent', webRoot: '/nonexistent', ...options });
  const { port } = await wslog.listen();
  return Object.assign(wslog, { base: `127.0.0.1:${port}` });
}

export function open(url: string, protocols?: string | string[], options?: WebSocket.ClientOptions): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  return new Promise((resolve) => ws.once('message', (data, isBinary) => resolve({ data: data as Buffer, isBinary })));
}

export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
