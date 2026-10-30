import { createMatcher } from '../../shared/filter.js';
import type { MessageRecord } from '../../shared/protocol.js';
import type { MessageQuery, MessageStore, StoreOptions } from './types.js';

/**
 * Ring buffer of records ordered by id. Appends are O(1); `get` is O(1)
 * because ids are increasing, so we can binary search.
 */
export class MemoryStore implements MessageStore {
  readonly kind: string = 'memory';
  private items: MessageRecord[] = [];
  private start = 0;
  private maxId = 0;

  constructor(private readonly options: StoreOptions) {}

  append(record: MessageRecord): void {
    this.items.push(record);
    this.maxId = Math.max(this.maxId, record.id);
    if (this.count() > this.options.maxMessages) this.start++;
    // Compact occasionally so dropped records can be garbage collected.
    if (this.start > 1024 && this.start > this.items.length / 2) {
      this.items = this.items.slice(this.start);
      this.start = 0;
    }
  }

  get(id: number): MessageRecord | undefined {
    const index = this.indexOf(id);
    return index === -1 ? undefined : this.items[index];
  }

  query(query: MessageQuery): MessageRecord[] {
    const limit = query.limit ?? this.options.maxMessages;
    const matches = createMatcher(query);
    const out: MessageRecord[] = [];
    for (let i = this.items.length - 1; i >= this.start && out.length < limit; i--) {
      const record = this.items[i]!;
      if (query.beforeId !== undefined && record.id >= query.beforeId) continue;
      if (matches(record)) out.push(record);
    }
    return out.reverse();
  }

  clear(): void {
    this.items = [];
    this.start = 0;
  }

  count(): number {
    return this.items.length - this.start;
  }

  lastId(): number {
    return this.maxId;
  }

  /** All live records, oldest first. */
  all(): MessageRecord[] {
    return this.items.slice(this.start);
  }

  async close(): Promise<void> {}

  private indexOf(id: number): number {
    let lo = this.start;
    let hi = this.items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midId = this.items[mid]!.id;
      if (midId === id) return mid;
      if (midId < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}
