import { STATUS_CODES } from 'node:http';
import type { Duplex } from 'node:stream';

/** Answer a WebSocket upgrade request with a plain HTTP error and close the socket. */
export function rejectUpgrade(socket: Duplex, status: number, message = STATUS_CODES[status] ?? ''): void {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Error'}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
}
