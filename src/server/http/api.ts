import { filterFromSearchParams } from '../../shared/filter.js';
import { LIVE_PAYLOAD_LIMIT, type MessageRecord, type TargetInfo } from '../../shared/protocol.js';
import { appInfo, publicTarget, publicTargets, shareUrl, type WslogContext } from '../context.js';
import { isWildcardHost } from '../config.js';
import { probeTarget, TargetError } from '../targets.js';
import { HttpError } from './auth.js';
import type { Router } from './router.js';

const DEFAULT_PAGE = 500;
const MAX_PAGE = 5000;

/** Shorten payloads for list/live transport. Full records come from `GET /api/messages/:id`. */
export function toPartial(record: MessageRecord): MessageRecord {
  if (record.payload.length <= LIVE_PAYLOAD_LIMIT) return record;
  return { ...record, payload: record.payload.slice(0, LIVE_PAYLOAD_LIMIT), partial: true };
}

export function registerApiRoutes(router: Router, ctx: WslogContext): void {
  const { store, targets, connections, bus } = ctx;

  router.get('/api/health', () => ({ ok: true }));

  router.get('/api/info', ({ role, req }) => appInfo(ctx, role, req));

  router.get('/api/targets', () => publicTargets(ctx));

  router.post(
    '/api/targets',
    async ({ body }) => {
      const { url } = await body<{ url?: unknown }>();
      if (typeof url !== 'string') throw new HttpError(400, 'Body must be {"url": "ws://..."}');
      let target: TargetInfo;
      try {
        target = targets.add(url);
      } catch (err) {
        if (err instanceof TargetError) throw new HttpError(400, err.message);
        throw err;
      }
      // Say so now, not when the app first fails to connect.
      const unreachable = await probeTarget(target.url);
      return publicTarget(ctx, unreachable ? { ...target, unreachable } : target);
    },
    { role: 'admin' },
  );

  router.delete(
    '/api/targets/:id',
    ({ params }) => {
      if (!targets.remove(params.id!)) throw new HttpError(404, 'Unknown target');
    },
    { role: 'admin' },
  );

  router.get('/api/connections', () => connections.list());

  router.get('/api/messages', ({ url }) => {
    const limit = clamp(Number(url.searchParams.get('limit') ?? DEFAULT_PAGE), 1, MAX_PAGE);
    const before = url.searchParams.get('beforeId');
    return store
      .query({ ...filterFromSearchParams(url.searchParams), limit, beforeId: before ? Number(before) : undefined })
      .map(toPartial);
  });

  router.get('/api/messages/:id', ({ params }) => {
    const record = store.get(Number(params.id));
    if (!record) throw new HttpError(404, 'Message not found (it may have been dropped by the storage limit)');
    return record;
  });

  router.delete(
    '/api/messages',
    () => {
      store.clear();
      connections.reset();
      bus.emit('cleared');
    },
    { role: 'admin' },
  );

  router.get('/api/export', ({ url, res }) => {
    const filter = filterFromSearchParams(url.searchParams);
    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        wslog: ctx.version,
        filter,
        targets: publicTargets(ctx),
        connections: connections.list(),
        messages: store.query(filter),
      },
      null,
      2,
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="wslog-${stamp}.json"`,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });

  router.get('/api/share', () => ({ url: shareUrl(ctx), networkReachable: isWildcardHost(ctx.config.host) }), { role: 'admin' });

  router.post(
    '/api/demo',
    async () => {
      const target = await ctx.demo.start();
      bus.emit('info');
      return publicTarget(ctx, target);
    },
    { role: 'admin' },
  );
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : min;
}
