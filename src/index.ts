/**
 * Programmatic API. Most people use the `wslog` CLI; import this to embed
 * wslog in tests or tools, or to extend it with plugins and storage backends.
 */
export { createWslog, type CreateWslogOptions, type Wslog } from './server/app.js';
export { DEFAULT_CONFIG, type WslogConfig } from './server/config.js';
export type { WslogContext } from './server/context.js';
export type { WslogEvents } from './server/events.js';
export { definePlugin, type PluginApi, type WslogPlugin } from './server/plugins.js';
export type { DraftRecord, MessageTransform } from './server/recorder.js';
export { registerStore, type MessageQuery, type MessageStore, type StoreOptions } from './server/storage/index.js';
export * from './shared/index.js';
