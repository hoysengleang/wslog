import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { nextMessage, open, startEchoServer, startWslog, waitFor } from './helpers/ws.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function setup(options: Parameters<typeof startWslog>[0] = {}) {
  const upstream = await startEchoServer();
  const wslog = await startWslog(options);
  cleanup.push(() => upstream.close(), () => wslog.close());
  const target = wslog.ctx.targets.add(upstream.url);
  return { upstream, wslog, target, proxyUrl: `ws://${wslog.base}${target.proxyPath}` };
}

describe('proxy', () => {
  it('forwards text in both directions and records both', async () => {
    const { wslog, proxyUrl } = await setup();
    const client = await open(proxyUrl);
    const reply = nextMessage(client);
    client.send('hello');
    expect(String((await reply).data)).toBe('echo:hello');

    await waitFor(() => wslog.ctx.store.count() === 2);
    const [out, inbound] = wslog.ctx.store.query({});
    expect(out).toMatchObject({ direction: 'out', payload: 'hello', kind: 'text', size: 5 });
    expect(inbound).toMatchObject({ direction: 'in', payload: 'echo:hello' });
    client.close();
  });

  it('forwards binary frames unchanged and stores them as base64', async () => {
    const { wslog, proxyUrl } = await setup();
    const client = await open(proxyUrl);
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    const reply = nextMessage(client);
    client.send(bytes);
    const { data, isBinary } = await reply;
    expect(isBinary).toBe(true);
    expect(Buffer.compare(data, bytes)).toBe(0);
    await waitFor(() => wslog.ctx.store.count() === 2);
    expect(wslog.ctx.store.query({})[0]).toMatchObject({ kind: 'binary', payload: bytes.toString('base64'), size: 5 });
    client.close();
  });

  it('masks configured fields before storing, but forwards the original', async () => {
    const { wslog, proxyUrl } = await setup({ mask: ['token'] });
    const client = await open(proxyUrl);
    const reply = nextMessage(client);
    client.send(JSON.stringify({ type: 'auth', token: 'secret-123' }));
    expect(String((await reply).data)).toContain('secret-123');

    await waitFor(() => wslog.ctx.store.count() === 2);
    for (const record of wslog.ctx.store.query({})) {
      expect(record.payload).not.toContain('secret-123');
      expect(record.payload).toContain('***');
    }
    client.close();
  });

  it('passes path and query through and masks them in connection info', async () => {
    const upstream = await startEchoServer();
    const wslog = await startWslog({ mask: ['key'] });
    cleanup.push(() => upstream.close(), () => wslog.close());
    const seen: string[] = [];
    upstream.wss.on('connection', (_ws, req) => seen.push(req.url ?? ''));
    const target = wslog.ctx.targets.add(`${upstream.url}/base`);

    const client = await open(`ws://${wslog.base}${target.proxyPath}/room/7?key=abc&x=1`);
    expect(seen).toEqual(['/base/room/7?key=abc&x=1']);
    const [connection] = wslog.ctx.connections.list();
    expect(connection?.path).toContain('key=***');
    expect(connection?.status).toBe('open');
    client.close();
  });

  it('passes the query string through exactly as sent: repeated keys, encoding, order', async () => {
    const upstream = await startEchoServer();
    const wslog = await startWslog();
    cleanup.push(() => upstream.close(), () => wslog.close());
    const seen: string[] = [];
    upstream.wss.on('connection', (_ws, req) => seen.push(req.url ?? ''));
    const plain = wslog.ctx.targets.add(upstream.url);
    const withQuery = wslog.ctx.targets.add(`${upstream.url}/ws?key=target&keep=1`);

    (await open(`ws://${wslog.base}${plain.proxyPath}/x?a=1&a=2&b=%20c,d&sig=AbC%2B`)).close();
    (await open(`ws://${wslog.base}${withQuery.proxyPath}?key=app`)).close();
    (await open(`ws://${wslog.base}${withQuery.proxyPath}`)).close();
    expect(seen).toEqual(['/x?a=1&a=2&b=%20c,d&sig=AbC%2B', '/ws?keep=1&key=app', '/ws?key=target&keep=1']);
  });

  it('masks secrets in binary frames that carry text, but forwards the original bytes', async () => {
    const { wslog, proxyUrl } = await setup({ mask: ['token'] });
    const client = await open(proxyUrl);
    const sent = Buffer.from(JSON.stringify({ token: 'bin-secret', n: 1 }));
    const reply = nextMessage(client);
    client.send(sent);
    expect(Buffer.compare((await reply).data, sent)).toBe(0);

    await waitFor(() => wslog.ctx.store.count() === 2);
    for (const record of wslog.ctx.store.query({})) {
      expect(record.kind).toBe('binary');
      expect(Buffer.from(record.payload, 'base64').toString()).toBe('{"token":"***","n":1}');
    }

    // Bytes that are not UTF-8 are stored untouched.
    const raw = Buffer.from([0xff, 0xfe, 0x74, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x61]);
    client.send(raw);
    await waitFor(() => wslog.ctx.store.count() === 4);
    expect(wslog.ctx.store.query({}).at(-1)?.payload).toBe(raw.toString('base64'));
    client.close();
  });

  it('negotiates the subprotocol chosen by the server', async () => {
    const upstream = await startEchoServer({ handleProtocols: (protocols) => (protocols.has('v2') ? 'v2' : false) });
    const wslog = await startWslog();
    cleanup.push(() => upstream.close(), () => wslog.close());
    const target = wslog.ctx.targets.add(upstream.url);

    const client = await open(`ws://${wslog.base}${target.proxyPath}`, ['v1', 'v2']);
    expect(client.protocol).toBe('v2');
    client.close();
  });

  it('passes the server close code to the client', async () => {
    const upstream = await startEchoServer();
    const wslog = await startWslog();
    cleanup.push(() => upstream.close(), () => wslog.close());
    upstream.wss.on('connection', (ws) => setTimeout(() => ws.close(4001, 'kicked'), 20));
    const target = wslog.ctx.targets.add(upstream.url);

    const client = await open(`ws://${wslog.base}${target.proxyPath}`);
    const [code, reason] = await new Promise<[number, string]>((resolve) => client.once('close', (c, r) => resolve([c, String(r)])));
    expect(code).toBe(4001);
    expect(reason).toBe('kicked');
    await waitFor(() => wslog.ctx.connections.list()[0]?.status === 'closed');
    expect(wslog.ctx.connections.list()[0]).toMatchObject({ closedBy: 'server', closeCode: 4001 });
  });

  it('passes an upstream handshake rejection through', async () => {
    const upstream = await startEchoServer({ verifyClient: (_info, cb) => cb(false, 401, 'Unauthorized') });
    const wslog = await startWslog();
    cleanup.push(() => upstream.close(), () => wslog.close());
    const target = wslog.ctx.targets.add(upstream.url);

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${wslog.base}${target.proxyPath}`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => {});
    });
    expect(status).toBe(401);
    await waitFor(() => wslog.ctx.connections.list()[0]?.status === 'error');
    expect(wslog.ctx.connections.list()[0]?.failure).toBe('rejected');
  });

  it('answers 502 when the target is unreachable and 404 for unknown targets', async () => {
    const wslog = await startWslog();
    cleanup.push(() => wslog.close());
    const target = wslog.ctx.targets.add('ws://127.0.0.1:1');

    const statusOf = (url: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url);
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('error', () => {});
      });
    expect(await statusOf(`ws://${wslog.base}${target.proxyPath}`)).toBe(502);
    expect(await statusOf(`ws://${wslog.base}/p/nope/chat`)).toBe(404);

    // Both show up in the dashboard with a reason, not only as a status code the app sees.
    await waitFor(() => wslog.ctx.connections.list().filter((c) => c.status === 'error').length === 2);
    const failures = wslog.ctx.connections.list().map((c) => ({ targetId: c.targetId, failure: c.failure }));
    expect(failures).toEqual([
      { targetId: target.id, failure: 'unreachable' },
      { targetId: 'nope', failure: 'no-target' },
    ]);
  });

  it('disconnects the apps of a removed target, and only those', async () => {
    const { wslog, target, proxyUrl, upstream } = await setup();
    const other = wslog.ctx.targets.add(`${upstream.url}/other`);
    const removedApp = await open(proxyUrl);
    const keptApp = await open(`ws://${wslog.base}${other.proxyPath}`);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      removedApp.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
    );

    wslog.ctx.targets.remove(target.id);
    expect(await closed).toEqual({ code: 1001, reason: 'Target removed in wslog' });
    await waitFor(() => wslog.ctx.connections.list().some((c) => c.status === 'closed'));
    expect(wslog.ctx.connections.list().find((c) => c.targetId === target.id)).toMatchObject({ closedBy: 'proxy', closeCode: 1001 });
    expect(keptApp.readyState).toBe(WebSocket.OPEN);
    keptApp.close();
  });

  it('truncates stored payloads above maxPayloadBytes but forwards everything', async () => {
    const { wslog, proxyUrl } = await setup({ maxPayloadBytes: 10 });
    const client = await open(proxyUrl);
    const reply = nextMessage(client);
    client.send('x'.repeat(100));
    expect(String((await reply).data)).toHaveLength(105);
    await waitFor(() => wslog.ctx.store.count() === 2);
    expect(wslog.ctx.store.query({})[0]).toMatchObject({ size: 100, truncated: true, payload: 'x'.repeat(10) });
    client.close();
  });
});
