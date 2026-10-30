import type { WslogContext } from './context.js';
import type { MessageTransform } from './recorder.js';

/**
 * Extension point for wslog. A plugin gets the full context and can:
 * - subscribe to events:        ctx.bus.on('message', ...)
 * - add HTTP routes:            ctx.router.get('/api/my-plugin', ...)
 * - change or drop messages:    api.transform(draft => ...)
 *
 * Plugins run in order, after built-in masking.
 */
export interface WslogPlugin {
  name: string;
  setup(ctx: WslogContext, api: PluginApi): void | Promise<void>;
  /** Called on shutdown, in reverse order. */
  teardown?(): void | Promise<void>;
}

export interface PluginApi {
  transform(fn: MessageTransform): void;
}

export function definePlugin(plugin: WslogPlugin): WslogPlugin {
  return plugin;
}
