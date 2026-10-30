import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LiveEvent } from '../src/shared/protocol.js';
import { nextMessage, open, startEchoServer, startWslog } from './helpers/ws.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

/** A built-dashboard stand-in, so requests reach the static file handler. */
function tempWebRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wslog-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** GET with full control over Host (fetch does not allow setting it). */
function rawGet(port: string, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Send raw bytes and return whatever comes back before the server closes. */
function rawRequest(port: string, data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), '127.0.0.1', () => socket.write(data));
    let response = '';
    socket.on('data', (chunk) => (response += chunk));
    socket.on('close', () => resolve(response));
    socket.on('error', reject);
  });
}

async function setup() {
  const wslog = await startWslog({ shareToken: 'share-tok', adminToken: 'admin-tok' });
  cleanup.push(() => wslog.close());
  const call = (path: string, init: RequestInit = {}) => fetch(`http://${wslog.base}${path}`, init);
  return { wslog, call };
}

describe('API', () => {
  it('adds, lists, and removes targets; ids are stable per URL', async () => {
    const { call } = await setup();
    const add = (url: string) =>
      call('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });

    const res = await add('localhost:8080/socket');
    expect(res.status).toBe(200);
    const target = (await res.json()) as { id: string; url: string; proxyPath: string };
    expect(target.url).toBe('ws://localhost:8080/socket');
    expect(target.proxyPath).toBe(`/p/${target.id}`);
    expect(((await (await add('ws://localhost:8080/socket')).json()) as { id: string }).id).toBe(target.id);

    expect((await add('ftp://nope')).status).toBe(400);
    expect(await (await call('/api/targets')).json()).toHaveLength(1);
    expect((await call(`/api/targets/${target.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await call('/api/targets')).json()).toHaveLength(0);
  });

  it('warns right away when a new target cannot be reached', async () => {
    const { call } = await setup();
    const upstream = await startEchoServer();
    cleanup.push(() => upstream.close());
    const add = async (url: string) =>
      (await (
        await call('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      ).json()) as { unreachable?: string };

    expect((await add('ws://127.0.0.1:1/down')).unreachable).toBe('nothing is listening on 127.0.0.1:1');
    expect((await add(upstream.url)).unreachable).toBeUndefined();
  });

  it('share token is read-only, wrong token is rejected', async () => {
    const { call } = await setup();
    const asViewer = { 'x-wslog-token': 'share-tok' };
    expect(((await (await call('/api/info', { headers: asViewer })).json()) as { role: string }).role).toBe('viewer');
    expect((await call('/api/messages', { headers: asViewer })).status).toBe(200);
    expect((await call('/api/messages', { method: 'DELETE', headers: asViewer })).status).toBe(403);
    expect((await call('/api/share', { headers: asViewer })).status).toBe(403);
    expect((await call('/api/info', { headers: { 'x-wslog-token': 'wrong' } })).status).toBe(401);
    expect(((await (await call('/api/info?token=admin-tok')).json()) as { role: string }).role).toBe('admin');
  });

  it('blocks cross-origin requests', async () => {
    const { call } = await setup();
    expect((await call('/api/info', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('blocks Origin: null (sandboxed iframes, local files) on the API and the live stream', async () => {
    const { wslog, call } = await setup();
    expect((await call('/api/messages', { headers: { Origin: 'null' } })).status).toBe(403);
    await expect(open(`ws://${wslog.base}/api/live`, undefined, { headers: { Origin: 'null' } })).rejects.toThrow(/403/);
    (await open(`ws://${wslog.base}/api/live`, undefined, { headers: { Origin: `http://${wslog.base}` } })).close();
  });

  it('on 0.0.0.0, a loopback request is admin only when Host is local too (DNS rebinding)', async () => {
    const wslog = await startWslog({ host: '0.0.0.0' });
    cleanup.push(() => wslog.close());
    const { port } = new URL(`http://${wslog.base}`);
    const rebound = await rawGet(port, '/api/info', { Host: `rebind.example:${port}`, Origin: `http://rebind.example:${port}` });
    expect(rebound.status).toBe(401);
    const local = await rawGet(port, '/api/info', { Host: `localhost:${port}` });
    expect(JSON.parse(local.body)).toMatchObject({ role: 'admin', proxyBaseUrl: `ws://localhost:${port}` });
  });

  it('shows proxy URLs for the address the dashboard was opened with (Docker port mappings)', async () => {
    const wslog = await startWslog({ host: '0.0.0.0', publicUrl: 'http://localhost:8080/' });
    cleanup.push(() => wslog.close());
    const { port } = new URL(`http://${wslog.base}`);
    const info = await rawGet(port, '/api/info', { Host: 'localhost:9999' });
    expect(JSON.parse(info.body).proxyBaseUrl).toBe('ws://localhost:9999');
    expect(wslog.dashboardUrl()).toBe('http://localhost:8080');
    expect(wslog.shareUrl()).toMatch(/^http:\/\/localhost:8080\/\?token=/);
  });

  it('answers malformed URLs with 400 and never crashes', async () => {
    const wslog = await startWslog({ webRoot: tempWebRoot() });
    cleanup.push(() => wslog.close());
    const call = (path: string, init: RequestInit = {}) => fetch(`http://${wslog.base}${path}`, init);
    const { port } = new URL(`http://${wslog.base}`);
    expect((await call('/api/targets/%E0%A4%A', { method: 'DELETE' })).status).toBe(400);
    expect((await call('/%E0%A4%A')).status).toBe(400);
    const upgrade = await rawRequest(
      port,
      'GET http://[x/ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
        'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    );
    expect(upgrade).toMatch(/^HTTP\/1\.1 400/);
    expect((await call('/api/health')).status).toBe(200);
  });

  it('never sends secrets in target URLs to dashboards or exports, but proxies with the real URL', async () => {
    const wslog = await startWslog({ mask: ['token'] });
    const upstream = await startEchoServer();
    cleanup.push(() => upstream.close(), () => wslog.close());
    const seen: string[] = [];
    upstream.wss.on('connection', (_ws, req) => seen.push(req.url ?? ''));
    const call = (path: string, init: RequestInit = {}) => fetch(`http://${wslog.base}${path}`, init);
    const secretUrl = `${upstream.url.replace('ws://', 'ws://ada:pw-secret@')}/ws?token=url-secret`;
    const added = await call('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: secretUrl }) });

    const dashboard = await open(`ws://${wslog.base}/api/live`);
    const hello = JSON.stringify(await nextMessage(dashboard).then((m) => JSON.parse(String(m.data))));
    dashboard.close();
    for (const body of [await added.text(), await (await call('/api/targets')).text(), await (await call('/api/export')).text(), hello]) {
      expect(body).not.toContain('url-secret');
      expect(body).not.toContain('pw-secret');
    }

    const target = wslog.ctx.targets.list()[0]!;
    (await open(`ws://${wslog.base}${target.proxyPath}`)).close();
    expect(seen).toEqual(['/ws?token=url-secret']);
  });

  it('does not let other sites frame the dashboard', async () => {
    const wslog = await startWslog({ webRoot: tempWebRoot() });
    cleanup.push(() => wslog.close());
    const res = await fetch(`http://${wslog.base}/`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });

  it('streams a hello snapshot and live messages to dashboards', async () => {
    const { wslog } = await setup();
    const upstream = await startEchoServer();
    cleanup.push(() => upstream.close());
    const target = wslog.ctx.targets.add(upstream.url);

    const dashboard = await open(`ws://${wslog.base}/api/live`);
    const events: LiveEvent[] = [];
    dashboard.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));

    const app = await open(`ws://${wslog.base}${target.proxyPath}`);
    app.send('ping');
    await new Promise((r) => setTimeout(r, 200));

    expect(events[0]?.type).toBe('hello');
    const live = events.filter((e) => e.type === 'messages').flatMap((e) => (e.type === 'messages' ? e.items : []));
    expect(live.map((m) => m.payload)).toEqual(['ping', 'echo:ping']);
    expect(events.some((e) => e.type === 'connection' && e.connection.status === 'open')).toBe(true);

    app.close();
    dashboard.close();
  });

  it('never sends a dashboard the same message twice when it connects mid-batch', async () => {
    const { wslog } = await setup();
    const upstream = await startEchoServer();
    cleanup.push(() => upstream.close());
    const target = wslog.ctx.targets.add(upstream.url);
    const app = await open(`ws://${wslog.base}${target.proxyPath}`);
    // Keep traffic flowing so messages are always waiting in the 50 ms batch.
    let n = 0;
    const sender = setInterval(() => app.send(`m${n++}`), 2);
    await new Promise((r) => setTimeout(r, 30));

    const dashboard = await open(`ws://${wslog.base}/api/live`);
    const ids: number[] = [];
    dashboard.on('message', (data) => {
      const event = JSON.parse(String(data)) as LiveEvent;
      if (event.type === 'hello') ids.push(...event.messages.map((m) => m.id));
      if (event.type === 'messages') ids.push(...event.items.map((m) => m.id));
    });
    await new Promise((r) => setTimeout(r, 100));
    clearInterval(sender);
    await new Promise((r) => setTimeout(r, 100));

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    app.close();
    dashboard.close();
  });

  it('clear starts fresh: drops finished connections and zeroes counters of open ones', async () => {
    const { wslog, call } = await setup();
    const upstream = await startEchoServer();
    cleanup.push(() => upstream.close());
    const target = wslog.ctx.targets.add(upstream.url);
    const gone = await open(`ws://${wslog.base}${target.proxyPath}`);
    gone.close();
    const live = await open(`ws://${wslog.base}${target.proxyPath}`);
    live.send('hi');
    await new Promise((r) => setTimeout(r, 100));

    const dashboard = await open(`ws://${wslog.base}/api/live`);
    const cleared = new Promise<LiveEvent>((resolve) =>
      dashboard.on('message', (data) => {
        const event = JSON.parse(String(data)) as LiveEvent;
        if (event.type === 'cleared') resolve(event);
      }),
    );
    expect((await call('/api/messages', { method: 'DELETE' })).status).toBe(204);

    const event = await cleared;
    expect(event.type === 'cleared' && event.connections.map((c) => [c.status, c.counts.in + c.counts.out])).toEqual([['open', 0]]);
    expect(wslog.ctx.connections.list()).toHaveLength(1);
    live.close();
    dashboard.close();
  });

  it('exports filtered messages as a JSON download', async () => {
    const { wslog, call } = await setup();
    const upstream = await startEchoServer();
    cleanup.push(() => upstream.close());
    const target = wslog.ctx.targets.add(upstream.url);
    const app = await open(`ws://${wslog.base}${target.proxyPath}`);
    app.send('one');
    await new Promise((r) => setTimeout(r, 100));

    const res = await call('/api/export?direction=in');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="wslog-.*\.json"/);
    const body = (await res.json()) as { messages: Array<{ payload: string }> };
    expect(body.messages.map((m) => m.payload)).toEqual(['echo:one']);
    app.close();
  });
});
