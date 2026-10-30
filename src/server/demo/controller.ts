import type { TargetInfo } from '../../shared/protocol.js';
import type { TargetRegistry } from '../targets.js';
import type { Logger } from '../util/logger.js';
import { startBots, type Bots } from './bots.js';
import { startChatServer, type ChatServer } from './chat-server.js';

export interface DemoDeps {
  targets: TargetRegistry;
  logger: Logger;
  /** Base URL the bots use to reach the proxy, e.g. `ws://127.0.0.1:4000`. */
  localProxyBase(): string;
}

/** Starts the fake chat server plus bots that talk to it through the proxy. */
export class DemoController {
  private server?: ChatServer;
  private bots?: Bots;
  private target?: TargetInfo;
  private starting?: Promise<TargetInfo>;

  constructor(private readonly deps: DemoDeps) {}

  get running(): boolean {
    return Boolean(this.target);
  }

  start(): Promise<TargetInfo> {
    if (this.target) return Promise.resolve(this.target);
    this.starting ??= (async () => {
      this.server = await startChatServer();
      const target = this.deps.targets.add(this.server.url, { demo: true });
      this.bots = startBots(`${this.deps.localProxyBase()}${target.proxyPath}`);
      this.target = target;
      this.deps.logger.debug(`demo chat server at ${this.server.url}`);
      return target;
    })();
    return this.starting;
  }

  async stop(): Promise<void> {
    this.bots?.stop();
    await this.server?.close();
    if (this.target) this.deps.targets.remove(this.target.id);
    this.server = this.bots = this.target = this.starting = undefined;
  }
}
