import { EventEmitter } from 'node:events';
import type { ConnectionInfo, MessageRecord, TargetInfo } from '../shared/protocol.js';

/** Everything that happens inside wslog. Plugins and the live hub subscribe here. */
export interface WslogEvents {
  message: [MessageRecord];
  connection: [ConnectionInfo];
  targets: [TargetInfo[]];
  cleared: [];
  info: [];
}

type Listener<K extends keyof WslogEvents> = (...args: WslogEvents[K]) => void;

/** Thin typed wrapper over EventEmitter. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on<K extends keyof WslogEvents>(event: K, listener: Listener<K>): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.off(event, listener);
  }

  off<K extends keyof WslogEvents>(event: K, listener: Listener<K>): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof WslogEvents>(event: K, ...args: WslogEvents[K]): void {
    this.emitter.emit(event, ...args);
  }
}
