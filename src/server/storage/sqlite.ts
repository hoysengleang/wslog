import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Direction, MessageRecord, PayloadKind } from '../../shared/protocol.js';
import { ensurePrivateFile } from '../paths.js';
import type { MessageQuery, MessageStore, StoreOptions } from './types.js';

// Minimal structural types for `node:sqlite` so we compile on Node versions
// whose @types do not ship it yet. The module is loaded lazily at runtime.
interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

interface Row {
  id: number;
  connection_id: string;
  target_id: string;
  direction: string;
  time: number;
  size: number;
  kind: string;
  payload: string;
  truncated: number;
}

/** SQLite storage via the built-in `node:sqlite` module (Node 22.13+). */
export class SqliteStore implements MessageStore {
  readonly kind: string;
  private readonly insert: Statement;
  private readonly prune: Statement;
  private readonly byId: Statement;
  private inserted = 0;
  private maxId: number;

  private constructor(
    private readonly db: Database,
    path: string,
    private readonly options: StoreOptions,
  ) {
    this.kind = `sqlite:${path}`;
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        connection_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        time INTEGER NOT NULL,
        size INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS messages_connection ON messages (connection_id, id);
    `);
    this.insert = db.prepare(
      `INSERT INTO messages (id, connection_id, target_id, direction, time, size, kind, payload, truncated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.prune = db.prepare('DELETE FROM messages WHERE id <= ?');
    this.byId = db.prepare('SELECT * FROM messages WHERE id = ? AND id > ?');
    this.maxId = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages').get()?.id ?? 0);
    this.enforceLimit();
  }

  static async open(path: string, options: StoreOptions): Promise<SqliteStore> {
    let sqlite: { DatabaseSync: new (path: string) => Database };
    try {
      sqlite = (await import('node:sqlite' as string)) as typeof sqlite;
    } catch {
      throw new Error(`SQLite storage needs Node.js 22.13 or newer (running ${process.version}). Use a .jsonl file instead.`);
    }
    mkdirSync(dirname(path), { recursive: true });
    // Before SQLite opens it: the -wal and -shm files copy the database's permissions.
    ensurePrivateFile(path);
    return new SqliteStore(new sqlite.DatabaseSync(path), path, options);
  }

  append(r: MessageRecord): void {
    this.insert.run(r.id, r.connectionId, r.targetId, r.direction, r.time, r.size, r.kind, r.payload, r.truncated ? 1 : 0);
    this.maxId = Math.max(this.maxId, r.id);
    // Prune in batches rather than on every insert.
    if (++this.inserted % 256 === 0) this.enforceLimit();
  }

  get(id: number): MessageRecord | undefined {
    const row = this.byId.get(id, this.maxId - this.options.maxMessages) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }

  query(query: MessageQuery): MessageRecord[] {
    const where: string[] = ['id > ?'];
    const params: unknown[] = [this.maxId - this.options.maxMessages];
    if (query.beforeId !== undefined) {
      where.push('id < ?');
      params.push(query.beforeId);
    }
    if (query.direction) {
      where.push('direction = ?');
      params.push(query.direction);
    }
    if (query.connectionId) {
      where.push('connection_id = ?');
      params.push(query.connectionId);
    }
    if (query.targetId) {
      where.push('target_id = ?');
      params.push(query.targetId);
    }
    if (query.q?.trim()) {
      where.push("payload LIKE ? ESCAPE '\\'");
      params.push(`%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`);
    }
    params.push(query.limit ?? this.options.maxMessages);
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...params) as unknown as Row[];
    return rows.reverse().map(toRecord);
  }

  clear(): void {
    this.db.exec('DELETE FROM messages');
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id > ?').get(this.maxId - this.options.maxMessages);
    return Number(row?.n ?? 0);
  }

  lastId(): number {
    return this.maxId;
  }

  async close(): Promise<void> {
    this.enforceLimit();
    this.db.close();
  }

  private enforceLimit(): void {
    this.prune.run(this.maxId - this.options.maxMessages);
  }
}

function toRecord(row: Row): MessageRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    targetId: row.target_id,
    direction: row.direction as Direction,
    time: row.time,
    size: row.size,
    kind: row.kind as PayloadKind,
    payload: row.payload,
    truncated: row.truncated === 1,
  };
}
