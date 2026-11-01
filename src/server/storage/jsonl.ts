import { closeSync, createReadStream, existsSync, mkdirSync, openSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { MessageRecord } from '../../shared/protocol.js';
import { ensurePrivateFile } from '../paths.js';
import { MemoryStore } from './memory.js';
import type { MessageQuery, MessageStore, StoreOptions } from './types.js';

/**
 * Append-only JSON Lines file with an in-memory index of the newest
 * `maxMessages` records. Writes are batched per event-loop tick, and the
 * file is compacted when it grows past twice the limit so disk use stays bounded.
 */
export class JsonlStore implements MessageStore {
  readonly kind: string;
  private readonly memory: MemoryStore;
  private fd = -1;
  private pending: string[] = [];
  private flushScheduled = false;
  private linesInFile = 0;

  private constructor(
    private readonly path: string,
    private readonly options: StoreOptions,
  ) {
    this.kind = `jsonl:${path}`;
    this.memory = new MemoryStore(options);
  }

  static async open(path: string, options: StoreOptions): Promise<JsonlStore> {
    const store = new JsonlStore(path, options);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    ensurePrivateFile(this.path);
    if (existsSync(this.path)) {
      const lines = createInterface({ input: createReadStream(this.path, 'utf8'), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.memory.append(JSON.parse(line) as MessageRecord);
          this.linesInFile++;
        } catch {
          // Skip a corrupt line (e.g. a partial write after a crash).
        }
      }
    }
    this.fd = openSync(this.path, 'a');
    if (this.linesInFile > this.options.maxMessages) this.rewrite(this.memory.all());
  }

  append(record: MessageRecord): void {
    this.memory.append(record);
    this.pending.push(`${JSON.stringify(record)}\n`);
    if (++this.linesInFile > this.options.maxMessages * 2) {
      this.rewrite(this.memory.all());
      return;
    }
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => this.flush());
    }
  }

  get(id: number): MessageRecord | undefined {
    return this.memory.get(id);
  }

  query(query: MessageQuery): MessageRecord[] {
    return this.memory.query(query);
  }

  clear(): void {
    this.memory.clear();
    this.rewrite([]);
  }

  count(): number {
    return this.memory.count();
  }

  lastId(): number {
    return this.memory.lastId();
  }

  async close(): Promise<void> {
    this.flush();
    if (this.fd !== -1) closeSync(this.fd);
    this.fd = -1;
  }

  private flush(): void {
    this.flushScheduled = false;
    if (!this.pending.length || this.fd === -1) return;
    const chunk = this.pending.join('');
    this.pending = [];
    writeSync(this.fd, chunk);
  }

  /** Replace the file with exactly `records` (pending writes are included in memory). */
  private rewrite(records: MessageRecord[]): void {
    this.pending = [];
    if (this.fd !== -1) closeSync(this.fd);
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, records.map((r) => `${JSON.stringify(r)}\n`).join(''), { mode: 0o600 });
    ensurePrivateFile(tmp);
    renameSync(tmp, this.path);
    this.linesInFile = records.length;
    this.fd = openSync(this.path, 'a');
  }
}
