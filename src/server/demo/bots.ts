import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

/** Simulated chat users that talk through the wslog proxy in demo mode. */

const LINES = [
  'anyone seen the deploy logs?',
  'pushed a fix for the reconnect bug 🎉',
  'lunch?',
  'the websocket keeps dropping after 60s, probably the load balancer idle timeout',
  'LGTM, merging',
  'can someone review #42',
  'coffee ☕',
  'rate limit is 100 msg/s per connection',
  'I think the heartbeat interval should be 25s',
  'ship it 🚀',
];

const BOTS = ['ada', 'linus', 'grace'];

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const between = (min: number, max: number) => min + Math.random() * (max - min);

export interface Bots {
  stop(): void;
}

export function startBots(proxyUrl: string): Bots {
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<WebSocket>();
  let stopped = false;

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!stopped) fn();
    }, ms);
    timers.add(t);
  };

  function connect(user: string, leavesAfterMs?: number) {
    const ws = new WebSocket(`${proxyUrl}?room=general&client=${user}`);
    sockets.add(ws);
    const send = (payload: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload));

    const talk = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const roll = Math.random();
      if (roll < 0.6) {
        send({ type: 'typing' });
        later(between(400, 1200), () => send({ type: 'message', text: pick(LINES) }));
      } else if (roll < 0.75) {
        send({
          type: 'message',
          text: 'here are the numbers',
          attachments: [
            { kind: 'table', rows: [{ region: 'eu-west', p50: 41, p99: 180 }, { region: 'us-east', p50: 37, p99: 152 }] },
            { kind: 'link', url: 'https://example.com/dashboards/latency', preview: { title: 'Latency', width: 1200, height: 630 } },
          ],
        });
      } else if (roll < 0.85) {
        ws.send(randomBytes(Math.floor(between(32, 256))), { binary: true });
      } else if (roll < 0.95) {
        send({ type: 'ping', t: Date.now() });
      } else {
        send({ type: 'auth.refresh', password: 'hunter2' });
      }
      later(between(1500, 5000), talk);
    };

    ws.on('open', () => {
      send({ type: 'join', user, token: `tok_${randomBytes(10).toString('hex')}` });
      later(between(500, 2000), talk);
      if (leavesAfterMs) later(leavesAfterMs, () => ws.close(1000, 'bye 👋'));
    });
    ws.on('close', () => {
      sockets.delete(ws);
      if (!stopped && leavesAfterMs) later(3000, () => connect(user, between(30_000, 60_000)));
    });
    ws.on('error', () => {
      // The proxy or chat server went away; the close handler decides what to do.
    });
  }

  BOTS.forEach((user, i) => later(i * 700, () => connect(user, i === 2 ? between(30_000, 45_000) : undefined)));

  return {
    stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      for (const ws of sockets) ws.close(1001, 'demo stopped');
    },
  };
}
