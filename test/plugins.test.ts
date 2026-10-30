import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin } from '../src/server/plugins.js';
import { open, startEchoServer, startWslog, waitFor } from './helpers/ws.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe('plugins', () => {
  it('can drop messages, add routes, and are torn down on close', async () => {
    let tornDown = false;
    const plugin = definePlugin({
      name: 'test',
      setup(ctx, api) {
        api.transform((draft) => (draft.payload.includes('heartbeat') ? null : draft));
        ctx.router.get('/api/test-plugin', () => ({ count: ctx.store.count() }));
      },
      teardown: () => {
        tornDown = true;
      },
    });
    const upstream = await startEchoServer();
    const wslog = await startWslog({ plugins: [plugin] });
    cleanup.push(() => upstream.close());
    const target = wslog.ctx.targets.add(upstream.url);

    const client = await open(`ws://${wslog.base}${target.proxyPath}`);
    client.send('heartbeat');
    client.send('hello');
    await waitFor(() => wslog.ctx.store.count() === 2);
    expect(wslog.ctx.store.query({}).map((m) => m.payload)).toEqual(['hello', 'echo:hello']);

    const res = await fetch(`http://${wslog.base}/api/test-plugin`);
    expect(await res.json()).toEqual({ count: 2 });

    client.close();
    await wslog.close();
    expect(tornDown).toBe(true);
  });
});
