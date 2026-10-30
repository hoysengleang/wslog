import { resolve } from 'node:path';
import { JsonlStore } from './jsonl.js';
import { MemoryStore } from './memory.js';
import { SqliteStore } from './sqlite.js';
import type { MessageStore, StoreOptions } from './types.js';

export type { MessageQuery, MessageStore, StoreOptions } from './types.js';
export { MemoryStore, JsonlStore, SqliteStore };

type StoreFactory = (path: string, options: StoreOptions) => Promise<MessageStore>;

/**
 * Store spec → factory. Specs look like `memory`, `./traffic.jsonl`,
 * `./traffic.db`, or an explicit `jsonl:path` / `sqlite:path`.
 */
const factories = new Map<string, StoreFactory>([
  ['memory', async (_path, options) => new MemoryStore(options)],
  ['jsonl', (path, options) => JsonlStore.open(path, options)],
  ['sqlite', (path, options) => SqliteStore.open(path, options)],
]);

/** Register a custom storage backend, used as `--store <scheme>:<path>`. */
export function registerStore(scheme: string, factory: StoreFactory): void {
  factories.set(scheme, factory);
}

export function parseStoreSpec(spec: string): { scheme: string; path: string } {
  const trimmed = spec.trim();
  if (!trimmed || trimmed === 'memory') return { scheme: 'memory', path: '' };
  const explicit = /^([a-z][a-z0-9+-]*):(?!\/\/|\\)(.+)$/i.exec(trimmed);
  if (explicit && factories.has(explicit[1]!.toLowerCase())) {
    return { scheme: explicit[1]!.toLowerCase(), path: explicit[2]! };
  }
  if (/\.jsonl?$/i.test(trimmed)) return { scheme: 'jsonl', path: trimmed };
  if (/\.(db|sqlite3?)$/i.test(trimmed)) return { scheme: 'sqlite', path: trimmed };
  throw new Error(`Unknown --store "${spec}". Use "memory", a .jsonl path, or a .db/.sqlite path.`);
}

export async function createStore(spec: string, options: StoreOptions): Promise<MessageStore> {
  const { scheme, path } = parseStoreSpec(spec);
  const factory = factories.get(scheme);
  if (!factory) throw new Error(`No storage backend registered for "${scheme}"`);
  return factory(path ? resolve(path) : '', options);
}
