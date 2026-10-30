import type { MessageFilter } from '../../shared/filter.js';
import type { MessageRecord } from '../../shared/protocol.js';

export interface MessageQuery extends MessageFilter {
  /** Only messages with `id < beforeId` (for paging backwards). */
  beforeId?: number;
  /** Max results; the newest matching messages are returned, oldest first. */
  limit?: number;
}

/**
 * Storage adapter contract. Implementations must keep at most `maxMessages`
 * records and drop the oldest first. Records arrive already masked.
 *
 * To add a backend, implement this interface and register a factory in
 * `storage/index.ts`.
 */
export interface MessageStore {
  /** Human-readable description, e.g. `memory` or `jsonl:./traffic.jsonl`. */
  readonly kind: string;
  append(record: MessageRecord): void;
  get(id: number): MessageRecord | undefined;
  query(query: MessageQuery): MessageRecord[];
  clear(): void;
  count(): number;
  /** Highest id ever stored (0 if empty) so ids keep increasing across restarts. */
  lastId(): number;
  close(): Promise<void>;
}

export interface StoreOptions {
  maxMessages: number;
}
