import { isUtf8 } from 'node:buffer';
import type { Direction, MessageRecord } from '../shared/protocol.js';
import type { ConnectionRegistry } from './connections.js';
import type { EventBus } from './events.js';
import type { Masker } from './masking.js';
import type { MessageStore } from './storage/types.js';

export type DraftRecord = Omit<MessageRecord, 'id'>;

/**
 * Runs on every message before it is stored. Return a (possibly changed)
 * draft, or `null` to drop the message. Masking is the first built-in transform.
 */
export type MessageTransform = (draft: DraftRecord) => DraftRecord | null;

export interface Frame {
  connectionId: string;
  targetId: string;
  direction: Direction;
  data: Buffer;
  isBinary: boolean;
}

export interface RecorderOptions {
  store: MessageStore;
  bus: EventBus;
  connections: ConnectionRegistry;
  maxPayloadBytes: number;
}

export function maskingTransform(masker: Masker): MessageTransform {
  if (!masker.fields.length) return (draft) => draft;
  return (draft) => {
    if (draft.kind === 'text') return { ...draft, payload: masker.text(draft.payload) };
    // Binary frames often carry text too, e.g. `ws.send(Buffer.from(JSON.stringify(msg)))`.
    const text = utf8Text(Buffer.from(draft.payload, 'base64'), draft.truncated);
    if (text === undefined) return draft;
    const masked = masker.text(text);
    return masked === text ? draft : { ...draft, payload: Buffer.from(masked, 'utf8').toString('base64') };
  };
}

/** The bytes as text if they are UTF-8. A truncated frame may end in the middle of a character. */
function utf8Text(bytes: Buffer, truncated: boolean): string | undefined {
  if (isUtf8(bytes)) return bytes.toString('utf8');
  for (let cut = 1; truncated && cut <= 3 && cut < bytes.length; cut++) {
    const head = bytes.subarray(0, bytes.length - cut);
    if (isUtf8(head)) return head.toString('utf8');
  }
  return undefined;
}

/** Turns raw proxied frames into stored, masked records and announces them. */
export class Recorder {
  private readonly transforms: MessageTransform[] = [];
  private nextId: number;

  constructor(private readonly options: RecorderOptions) {
    this.nextId = options.store.lastId() + 1;
  }

  use(transform: MessageTransform): void {
    this.transforms.push(transform);
  }

  record(frame: Frame): MessageRecord | undefined {
    const { data, isBinary } = frame;
    const truncated = data.length > this.options.maxPayloadBytes;
    const body = truncated ? data.subarray(0, this.options.maxPayloadBytes) : data;

    let draft: DraftRecord | null = {
      connectionId: frame.connectionId,
      targetId: frame.targetId,
      direction: frame.direction,
      time: Date.now(),
      size: data.length,
      kind: isBinary ? 'binary' : 'text',
      payload: isBinary ? body.toString('base64') : body.toString('utf8'),
      truncated,
    };
    for (const transform of this.transforms) {
      draft = transform(draft);
      if (!draft) return undefined;
    }

    const record: MessageRecord = { id: this.nextId++, ...draft };
    this.options.store.append(record);
    this.options.connections.countMessage(record.connectionId, record.direction, record.size);
    this.options.bus.emit('message', record);
    return record;
  }
}
