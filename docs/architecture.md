# Architecture

One Node.js process holds the proxy, recorder, storage, and dashboard, so installing wslog is a single command.

```
 your app ──ws──▶  /p/<target>  ──▶ WebSocketProxy ──ws──▶ your server
                                        │
                                        ▼
                                    Recorder ── transforms (masking, plugins)
                                        │
                              ┌─────────┴─────────┐
                              ▼                   ▼
                        MessageStore          EventBus ──▶ LiveHub ──/api/live──▶ dashboard
                   (memory/jsonl/sqlite)                      ▲
                                                              │
                                     REST /api/* ─────────────┘
```

Every message passes through the proxy, which hands a copy to the recorder. The recorder masks it, stores it, and announces it on the event bus; the live hub batches events every 50 ms and streams them to dashboards.

## Layout

```
src/
  shared/          Types and logic used by BOTH server and dashboard
    protocol.ts    Wire types: MessageRecord, ConnectionInfo, LiveEvent, ...
    filter.ts      One filter definition for UI, API, and export
  server/
    app.ts         Composition root: builds and wires everything
    context.ts     WslogContext: what routes and plugins receive
    config.ts      Config type, defaults, validation
    events.ts      Typed event bus
    targets.ts     Target registry + upstream URL building
    connections.ts Connection registry + message rates
    recorder.ts    Frame → masked, stored record (transform pipeline)
    masking.ts     JSON / text / URL masking
    proxy/         WebSocket bridge and header forwarding
    storage/       MessageStore interface + memory, JSONL, SQLite
    http/          HTTP server, router, auth, REST API, live hub, static files
    demo/          Fake chat server + bots
    plugins.ts     Plugin interface
  cli/             Argument parsing and the `wslog` binary
  index.ts         Public programmatic API
web/src/
  api/             REST client + live socket with reconnect
  state/store.ts   Single external store (useSyncExternalStore)
  hooks/           Virtualized rows, proxy URL
  components/      TopBar, Sidebar, Toolbar, TrafficTable, DetailPane, JsonTree, ...
test/              Vitest: proxy, API, storage, masking, CLI, targets
e2e/               Playwright: every dashboard flow in a real browser (fixtures.ts starts wslog + a misbehaving server)
```

Rules of thumb:

- Anything that crosses the wire is typed in `src/shared/protocol.ts`. Change it there and both sides fail to compile until they agree.
- Subsystems talk through the `EventBus`, not by calling each other. The live hub, for example, only listens.
- The proxy never blocks on storage or the dashboard; it forwards the frame regardless.

## Extending wslog

### Plugins

```ts
import { createWslog, definePlugin } from 'wslog-cli';

const dropHeartbeats = definePlugin({
  name: 'drop-heartbeats',
  setup(ctx, api) {
    // Change or drop messages before they are stored (runs after masking).
    api.transform((draft) => (draft.payload === '{"type":"ping"}' ? null : draft));

    // React to events.
    ctx.bus.on('connection', (c) => c.status === 'error' && console.warn(c.error));

    // Add HTTP routes (role: 'admin' for anything that writes).
    ctx.router.get('/api/stats', () => ({ messages: ctx.store.count() }));
  },
});

const wslog = await createWslog({ port: 4000, plugins: [dropHeartbeats] });
await wslog.listen();
```

### Storage backends

Implement `MessageStore` (`src/server/storage/types.ts`) and register it:

```ts
import { registerStore } from 'wslog-cli';
registerStore('redis', async (path, { maxMessages }) => new RedisStore(path, maxMessages));
// wslog --store redis:localhost:6379
```

### Embedding in tests

```ts
const wslog = await createWslog({ port: 0, logLevel: 'silent' });
const { port } = await wslog.listen();
const target = wslog.ctx.targets.add('ws://localhost:8080');
// connect your client to ws://127.0.0.1:${port}${target.proxyPath}
// assert on wslog.ctx.store.query({ direction: 'out' })
await wslog.close();
```

## Roadmap ideas (after v0.1)

- Replay or edit-and-resend a message
- Inject latency or drop frames for chaos testing
- Persist connections, not only messages and targets
- `wss://` termination with self-signed certs (`--insecure` upstream)
- Per-target masking rules and payload decoders (protobuf, msgpack)
