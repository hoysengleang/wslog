import { useSyncExternalStore } from 'react';
import type { MessageFilter } from '../../../src/shared/filter';
import type { AppInfo, ConnectionInfo, LiveEvent, MessageRecord, TargetInfo } from '../../../src/shared/protocol';
import { api } from '../api/client';
import type { LiveStatus } from '../api/live';

/** How many messages the browser keeps. Older ones stay on the server. */
export const CLIENT_LIMIT = 20_000;
/** Seconds of history in each connection's sparkline. */
export const RATE_WINDOW = 30;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export interface DashboardState {
  status: LiveStatus;
  info?: AppInfo;
  targets: TargetInfo[];
  activeTargetId?: string;
  connections: Record<string, ConnectionInfo>;
  rates: Record<string, number[]>;
  messages: MessageRecord[];
  /** Messages received while paused, shown on resume. */
  held: MessageRecord[];
  paused: boolean;
  filter: MessageFilter;
  selectedId?: number;
  toasts: Toast[];
}

const initialState: DashboardState = {
  status: 'connecting',
  targets: [],
  connections: {},
  rates: {},
  messages: [],
  held: [],
  paused: false,
  filter: {},
  toasts: [],
};

type Listener = () => void;

/** Minimal external store: one immutable state object, replaced on every change. */
function createStore<S>(initial: S) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(update: Partial<S> | ((s: S) => Partial<S>)) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const store = createStore(initialState);

/** Subscribe a component to a slice of state. Select stable references, not new objects. */
export function useStore<T>(selector: (s: DashboardState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

const cap = <T>(items: T[]) => (items.length > CLIENT_LIMIT ? items.slice(-CLIENT_LIMIT) : items);

/**
 * Show the traffic view rather than onboarding. Traffic can outlive its target:
 * removing a target leaves already-connected clients running.
 */
export const showsTraffic = (s: DashboardState) => s.targets.length > 0 || s.messages.length > 0;

export function applyLiveEvent(event: LiveEvent): void {
  switch (event.type) {
    case 'hello':
      store.set((s) => ({
        info: event.info,
        targets: event.targets,
        activeTargetId: pickActiveTarget(event.targets, s.activeTargetId),
        filter: dropRemovedTarget(s.filter, event.targets),
        connections: Object.fromEntries(event.connections.map((c) => [c.id, c])),
        messages: event.messages,
        held: [],
      }));
      break;
    case 'messages':
      store.set((s) => (s.paused ? { held: cap([...s.held, ...event.items]) } : { messages: cap([...s.messages, ...event.items]) }));
      break;
    case 'connection': {
      const { connection } = event;
      const before = store.get();
      store.set((s) => ({ connections: { ...s.connections, [connection.id]: connection } }));
      // With an empty table the main view explains the failure; over a busy table, a toast does.
      if (connection.status === 'error' && before.connections[connection.id]?.status !== 'error' && before.messages.length) {
        actions.toast(`Connection failed: ${connection.error ?? 'unknown error'}`, 'error');
      }
      break;
    }
    case 'targets':
      store.set((s) => ({
        targets: event.targets,
        activeTargetId: pickActiveTarget(event.targets, s.activeTargetId),
        filter: dropRemovedTarget(s.filter, event.targets),
      }));
      break;
    case 'rates':
      store.set((s) => {
        const rates: Record<string, number[]> = {};
        for (const [id, n] of Object.entries(event.rates)) {
          rates[id] = [...(s.rates[id] ?? []), n].slice(-RATE_WINDOW);
        }
        return { rates };
      });
      break;
    case 'cleared':
      store.set((s) => ({
        messages: [],
        held: [],
        selectedId: undefined,
        connections: Object.fromEntries(event.connections.map((c) => [c.id, c])),
        filter: s.filter.connectionId && !event.connections.some((c) => c.id === s.filter.connectionId) ? { ...s.filter, connectionId: undefined } : s.filter,
      }));
      break;
    case 'info':
      store.set((s) => (s.info ? { info: { ...s.info, ...event.info } } : {}));
      break;
  }
}

function pickActiveTarget(targets: TargetInfo[], current?: string): string | undefined {
  if (current && targets.some((t) => t.id === current)) return current;
  return targets.at(-1)?.id;
}

/** Stop filtering by a target that no longer exists, or the table would stay empty. */
function dropRemovedTarget(filter: MessageFilter, targets: TargetInfo[]): MessageFilter {
  return filter.targetId && !targets.some((t) => t.id === filter.targetId) ? { ...filter, targetId: undefined } : filter;
}

export const actions = {
  setStatus: (status: LiveStatus) => store.set({ status }),
  setFilter: (patch: Partial<MessageFilter>) => store.set((s) => ({ filter: { ...s.filter, ...patch } })),
  select: (selectedId: number | undefined) => store.set({ selectedId }),
  setActiveTarget: (activeTargetId: string) => store.set({ activeTargetId }),
  /** Show only one target's traffic (and put its proxy URL in the top bar), or all targets. */
  selectTarget: (targetId: string | undefined) =>
    store.set((s) => {
      const connection = s.filter.connectionId ? s.connections[s.filter.connectionId] : undefined;
      const keepConnection = !targetId || connection?.targetId === targetId;
      return {
        activeTargetId: targetId ?? s.activeTargetId,
        filter: { ...s.filter, targetId, connectionId: keepConnection ? s.filter.connectionId : undefined },
      };
    }),
  /**
   * The browser starts with only the newest messages. Fetch older ones matching
   * `filter` from the server so selecting an old connection never shows an empty table.
   */
  async loadOlder(filter: MessageFilter): Promise<void> {
    const oldest = store.get().messages[0]?.id;
    if (oldest === undefined) return;
    try {
      const older = await api.messagesBefore(filter, oldest);
      // Skip if the list was replaced meanwhile (clear, reconnect); the ids would no longer line up.
      store.set((s) => (older.length && s.messages[0]?.id === oldest ? { messages: [...older, ...s.messages] } : {}));
    } catch (err) {
      actions.toast(`Could not load older messages: ${(err as Error).message}`, 'error');
    }
  },
  togglePause: () =>
    store.set((s) => (s.paused ? { paused: false, held: [], messages: cap([...s.messages, ...s.held]) } : { paused: true })),
  toast(text: string, tone: Toast['tone'] = 'info') {
    // An app stuck in a reconnect loop fails the same way every second; show it once.
    if (store.get().toasts.some((t) => t.text === text)) return;
    const toast = { id: Date.now() + Math.random(), text, tone };
    store.set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) })), tone === 'error' ? 5000 : 2200);
  },
};
