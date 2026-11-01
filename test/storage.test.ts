import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { MessageRecord } from '../src/shared/protocol.js';
import { createStore, parseStoreSpec } from '../src/server/storage/index.js';
import type { MessageStore } from '../src/server/storage/types.js';

const dir = mkdtempSync(join(tmpdir(), 'wslog-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function record(id: number, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id,
    connectionId: id % 2 ? 'c1' : 'c2',
    targetId: 't1',
    direction: id % 2 ? 'out' : 'in',
    time: 1_000 + id,
    size: 10,
    kind: 'text',
    payload: `message ${id}`,
    truncated: false,
    ...overrides,
  };
}

const backends: Array<[string, () => string]> = [
  ['memory', () => 'memory'],
  ['jsonl', () => join(dir, `${Math.random()}.jsonl`)],
  ['sqlite', () => join(dir, `${Math.random()}.db`)],
];

describe.each(backends)('%s store', (_name, spec) => {
  const open = (s: string, maxMessages = 5): Promise<MessageStore> => createStore(s, { maxMessages });

  it('keeps only the newest maxMessages', async () => {
    const store = await open(spec());
    for (let i = 1; i <= 8; i++) store.append(record(i));
    expect(store.count()).toBe(5);
    expect(store.query({}).map((r) => r.id)).toEqual([4, 5, 6, 7, 8]);
    expect(store.get(2)).toBeUndefined();
    expect(store.get(7)?.payload).toBe('message 7');
    expect(store.lastId()).toBe(8);
    await store.close();
  });

  it('filters and pages', async () => {
    const store = await open(spec(), 100);
    for (let i = 1; i <= 10; i++) store.append(record(i));
    expect(store.query({ direction: 'out' }).map((r) => r.id)).toEqual([1, 3, 5, 7, 9]);
    expect(store.query({ connectionId: 'c2', limit: 2 }).map((r) => r.id)).toEqual([8, 10]);
    expect(store.query({ q: 'MESSAGE 1' }).map((r) => r.id)).toEqual([1, 10]);
    expect(store.query({ beforeId: 4 }).map((r) => r.id)).toEqual([1, 2, 3]);
    store.clear();
    expect(store.count()).toBe(0);
    await store.close();
  });
});

describe('persistent stores', () => {
  it.each(['jsonl', 'db'])('reload records and keep ids increasing (%s)', async (ext) => {
    const path = join(dir, `reload.${ext}`);
    const first = await createStore(path, { maxMessages: 3 });
    for (let i = 1; i <= 4; i++) first.append(record(i));
    await first.close();

    const second = await createStore(path, { maxMessages: 3 });
    expect(second.query({}).map((r) => r.id)).toEqual([2, 3, 4]);
    expect(second.lastId()).toBe(4);
    await second.close();
  });

  it('compacts the JSONL file', async () => {
    const path = join(dir, 'compact.jsonl');
    const store = await createStore(path, { maxMessages: 2 });
    for (let i = 1; i <= 5; i++) store.append(record(i));
    await store.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it.each(['jsonl', 'db'])('keeps traffic files private, even ones that already existed (%s)', async (ext) => {
    const fresh = join(dir, `private.${ext}`);
    const existing = join(dir, `existing.${ext}`);
    writeFileSync(existing, '', { mode: 0o644 });
    for (const path of [fresh, existing]) {
      const store = await createStore(path, { maxMessages: 2 });
      for (let i = 1; i <= 5; i++) store.append(record(i)); // JSONL compacts into a new file
      await store.close();
      for (const file of [path, `${path}-wal`, `${path}-shm`].filter(existsSync)) {
        expect(statSync(file).mode & 0o777, file).toBe(0o600);
      }
    }
  });
});

describe('parseStoreSpec', () => {
  it('infers the backend from the spec', () => {
    expect(parseStoreSpec('memory')).toEqual({ scheme: 'memory', path: '' });
    expect(parseStoreSpec('./a.jsonl')).toEqual({ scheme: 'jsonl', path: './a.jsonl' });
    expect(parseStoreSpec('data/a.sqlite')).toEqual({ scheme: 'sqlite', path: 'data/a.sqlite' });
    expect(parseStoreSpec('jsonl:./log.txt')).toEqual({ scheme: 'jsonl', path: './log.txt' });
    expect(() => parseStoreSpec('./a.txt')).toThrow(/Unknown --store/);
  });
});
