import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { isWildcardHost, resolveConfig, type WslogConfig } from './config.js';
import { ConnectionRegistry } from './connections.js';
import { dashboardUrl, shareUrl, type WslogContext } from './context.js';
import { DemoController } from './demo/controller.js';
import { EventBus } from './events.js';
import { registerApiRoutes } from './http/api.js';
import { LiveHub } from './http/live.js';
import { Router } from './http/router.js';
import { createHttpServer } from './http/server.js';
import { createMasker } from './masking.js';
import { defaultWebRoot, readVersion } from './paths.js';
import type { WslogPlugin } from './plugins.js';
import { WebSocketProxy } from './proxy/proxy.js';
import { maskingTransform, Recorder } from './recorder.js';
import { createStore } from './storage/index.js';
import { persistTargets, TargetRegistry } from './targets.js';
import { createLogger } from './util/logger.js';

export interface CreateWslogOptions extends Partial<WslogConfig> {
  plugins?: WslogPlugin[];
}

export interface Wslog {
  readonly ctx: WslogContext;
  /** Start listening. Resolves once the dashboard URL is reachable. */
  listen(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
  dashboardUrl(): string;
  shareUrl(): string;
}

/** Composition root: wires every subsystem together. */
export async function createWslog(options: CreateWslogOptions = {}): Promise<Wslog> {
  const { plugins = [], ...configInput } = options;
  const config = resolveConfig(configInput);
  const logger = createLogger(config.logLevel);
  const bus = new EventBus();
  const store = await createStore(config.store, { maxMessages: config.maxMessages });
  const masker = createMasker(config.mask);
  const targets = new TargetRegistry(bus);
  const connections = new ConnectionRegistry(bus);
  const recorder = new Recorder({ store, bus, connections, maxPayloadBytes: config.maxPayloadBytes });
  recorder.use(maskingTransform(masker));
  const router = new Router();

  // `httpServer` is created below; this is only called once it exists.
  const port = () => (httpServer.address() as AddressInfo | null)?.port ?? config.port;

  const demo = new DemoController({
    targets,
    logger,
    localProxyBase: () => {
      const host = isWildcardHost(config.host) ? '127.0.0.1' : config.host;
      return `ws://${host.includes(':') ? `[${host}]` : host}:${port()}`;
    },
  });

  const ctx: WslogContext = {
    config,
    version: readVersion(),
    logger,
    bus,
    store,
    targets,
    connections,
    recorder,
    masker,
    router,
    demo,
    port,
  };

  for (const plugin of plugins) {
    await plugin.setup(ctx, { transform: (fn) => recorder.use(fn) });
    logger.debug(`plugin loaded: ${plugin.name}`);
  }
  registerApiRoutes(router, ctx);

  if (config.targetsFile) persistTargets(targets, bus, config.targetsFile, logger);
  for (const url of config.targets) targets.add(url);

  const proxy = new WebSocketProxy({ connections, recorder, masker, logger });
  bus.on('targets', (list) => proxy.closeRemovedTargets(list));
  const live = new LiveHub(ctx);
  const httpServer = createHttpServer({ ctx, proxy, live, webRoot: resolve(config.webRoot ?? defaultWebRoot) });

  return {
    ctx,
    async listen() {
      await new Promise<void>((resolveListen, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off('error', reject);
          resolveListen();
        });
      });
      if (config.demo) await demo.start();
      return { port: port(), url: dashboardUrl(ctx) };
    },
    async close() {
      await demo.stop();
      live.close();
      proxy.closeAll();
      httpServer.closeAllConnections();
      await new Promise<void>((done) => httpServer.close(() => done()));
      for (const plugin of [...plugins].reverse()) await plugin.teardown?.();
      await store.close();
    },
    dashboardUrl: () => dashboardUrl(ctx),
    shareUrl: () => shareUrl(ctx),
  };
}
