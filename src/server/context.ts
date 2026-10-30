import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { AppInfo, Role, TargetInfo } from '../shared/protocol.js';
import { isLoopbackHost, isWildcardHost, type WslogConfig } from './config.js';
import type { ConnectionRegistry } from './connections.js';
import type { DemoController } from './demo/controller.js';
import type { EventBus } from './events.js';
import type { Router } from './http/router.js';
import type { Masker } from './masking.js';
import type { Recorder } from './recorder.js';
import type { MessageStore } from './storage/types.js';
import type { TargetRegistry } from './targets.js';
import type { Logger } from './util/logger.js';

/** Everything a route, plugin, or subsystem may need. Built once in `app.ts`. */
export interface WslogContext {
  readonly config: WslogConfig;
  readonly version: string;
  readonly logger: Logger;
  readonly bus: EventBus;
  readonly store: MessageStore;
  readonly targets: TargetRegistry;
  readonly connections: ConnectionRegistry;
  readonly recorder: Recorder;
  readonly masker: Masker;
  readonly router: Router;
  readonly demo: DemoController;
  /** Port actually listened on (differs from config when config.port is 0). */
  port(): number;
}

/** Hostname other machines/apps should use to reach this wslog, when no request tells us better. */
function publicHostname(config: WslogConfig): string {
  if (isWildcardHost(config.host)) return lanAddress() || 'localhost';
  return config.host.includes(':') ? `[${config.host}]` : config.host;
}

export function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return undefined;
}

/** The dashboard address wslog prints and hands out. `publicUrl` wins (e.g. Docker, where wslog cannot see the host's port). */
export function dashboardUrl(ctx: WslogContext): string {
  if (ctx.config.publicUrl) return ctx.config.publicUrl;
  const hostname = publicHostname(ctx.config);
  const display = isLoopbackHost(hostname) ? 'localhost' : hostname;
  return `http://${display}:${ctx.port()}`;
}

export function shareUrl(ctx: WslogContext): string {
  return `${dashboardUrl(ctx)}/?token=${encodeURIComponent(ctx.config.shareToken)}`;
}

/**
 * Base for the proxy URLs a dashboard shows. When wslog listens on every
 * interface, the address the viewer's browser used is the one their apps can
 * use too, including a Docker port mapping (`-p 8080:4000`).
 */
function proxyBaseUrl(ctx: WslogContext, req?: IncomingMessage): string {
  if (isWildcardHost(ctx.config.host) && req?.headers.host) return `ws://${req.headers.host}`;
  if (ctx.config.publicUrl) {
    const url = new URL(ctx.config.publicUrl);
    return `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  }
  return `ws://${publicHostname(ctx.config)}:${ctx.port()}`;
}

/** A target as dashboards, share links, and exports see it: secrets in its URL masked. Proxying uses the real URL. */
export function publicTarget<T extends TargetInfo>(ctx: WslogContext, target: T): T {
  return { ...target, url: ctx.masker.url(target.url) };
}

export function publicTargets(ctx: WslogContext, targets = ctx.targets.list()): TargetInfo[] {
  return targets.map((t) => publicTarget(ctx, t));
}

export function baseInfo(ctx: WslogContext, req?: IncomingMessage): Omit<AppInfo, 'role'> {
  return {
    name: 'wslog',
    version: ctx.version,
    proxyBaseUrl: proxyBaseUrl(ctx, req),
    maskFields: [...ctx.masker.fields],
    maxMessages: ctx.config.maxMessages,
    storage: ctx.store.kind,
    demoRunning: ctx.demo.running,
  };
}

export function appInfo(ctx: WslogContext, role: Role, req?: IncomingMessage): AppInfo {
  return { ...baseInfo(ctx, req), role };
}
