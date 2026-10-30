import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

/**
 * A tiny fake chat server used by demo mode. It speaks a JSON protocol
 * with a few message shapes so the dashboard has something realistic to show.
 */
export interface ChatServer {
  url: string;
  close(): Promise<void>;
}

interface Member {
  user: string;
  ws: WebSocket;
}

export async function startChatServer(): Promise<ChatServer> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/chat' });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const { port } = wss.address() as AddressInfo;

  const members = new Set<Member>();
  let nextMessageId = 1;
  const startedAt = Date.now();

  const broadcast = (payload: unknown) => {
    const data = JSON.stringify(payload);
    for (const m of members) if (m.ws.readyState === WebSocket.OPEN) m.ws.send(data);
  };
  const online = () => [...members].map((m) => m.user);

  wss.on('connection', (ws, req) => {
    const room = new URL(req.url ?? '/', 'http://x').searchParams.get('room') ?? 'general';
    let member: Member | undefined;

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.send(JSON.stringify({ type: 'ack', kind: 'binary', bytes: (data as Buffer).length }));
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'bad_json', message: 'Expected JSON' }));
        return;
      }
      switch (msg.type) {
        case 'join': {
          member = { user: String(msg.user ?? 'anon'), ws };
          members.add(member);
          ws.send(
            JSON.stringify({
              type: 'welcome',
              room,
              session: { id: randomBytes(6).toString('hex'), token: `sess_${randomBytes(12).toString('hex')}`, expiresIn: 3600 },
              online: online(),
            }),
          );
          broadcast({ type: 'presence', event: 'joined', user: member.user, online: online() });
          break;
        }
        case 'typing':
          broadcast({ type: 'typing', user: member?.user });
          break;
        case 'message':
          broadcast({
            type: 'message',
            id: nextMessageId++,
            room,
            user: member?.user,
            text: msg.text,
            attachments: msg.attachments ?? [],
            ts: new Date().toISOString(),
          });
          break;
        case 'auth.refresh':
          ws.send(JSON.stringify({ type: 'auth.ok', token: `sess_${randomBytes(12).toString('hex')}` }));
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', code: 'unknown_type', message: `Unknown type ${String(msg.type)}` }));
      }
    });

    ws.on('close', () => {
      if (!member) return;
      members.delete(member);
      broadcast({ type: 'presence', event: 'left', user: member.user, online: online() });
    });
  });

  const stats = setInterval(() => {
    broadcast({ type: 'stats', online: members.size, messages: nextMessageId - 1, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
  }, 10_000);

  return {
    url: `ws://127.0.0.1:${port}/chat`,
    close: () =>
      new Promise((resolve) => {
        clearInterval(stats);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
