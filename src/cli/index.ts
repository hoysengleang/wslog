#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWslog } from '../server/app.js';
import { isLoopbackHost } from '../server/config.js';
import { readVersion } from '../server/paths.js';
import { color } from '../server/util/logger.js';
import { HELP, parseCliArgs } from './args.js';

async function main(): Promise<void> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(color.red(`✖ ${(err as Error).message}`));
    console.error('Run `wslog --help` for usage.');
    process.exit(2);
  }
  if (options.help) return void console.log(HELP);
  if (options.version) return void console.log(readVersion());

  const wslog = await createWslog(options.config);
  const { config, targets, store, masker, logger } = wslog.ctx;

  try {
    await wslog.listen();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') throw new Error(`Port ${config.port} is already in use. Try --port ${config.port + 1}.`, { cause: err });
    throw err;
  }

  const url = wslog.dashboardUrl();
  const { protocol, host, hostname } = new URL(url);
  const proxyBase = config.publicUrl
    ? `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`
    : `ws://${isLoopbackHost(config.host) ? '127.0.0.1' : hostname}:${wslog.ctx.port()}`;
  logger.info('');
  logger.info(`  ${color.bold('wslog')} ${color.dim(`v${wslog.ctx.version}`)}`);
  logger.info('');
  logger.info(`  ${color.green('➜')}  Dashboard  ${color.cyan(url)}`);
  for (const t of targets.list()) {
    logger.info(`  ${color.green('➜')}  Proxy      ${color.cyan(proxyBase + t.proxyPath)} ${color.dim(`→ ${masker.url(t.url)}`)}`);
  }
  logger.info(`     Storage    ${color.dim(store.kind)}${masker.fields.length ? color.dim(`  ·  masking ${masker.fields.join(', ')}`) : ''}`);
  if (!isLoopbackHost(config.host)) {
    logger.info('');
    logger.info(`  ${color.yellow('!')}  Listening on ${config.host}. Anyone on this network can reach the proxy.`);
    logger.info(`     Admin link (keep private): ${color.cyan(`${url}/?token=${config.adminToken}`)}`);
    logger.info(`     Read-only share link:      ${color.cyan(wslog.shareUrl())}`);
  }
  logger.info('');
  if (!targets.list().length) logger.info(color.dim('  Open the dashboard and paste your WebSocket server URL to get started.\n'));

  if (options.open) openBrowser(url);

  let closing = false;
  const shutdown = async () => {
    if (closing) process.exit(1);
    closing = true;
    logger.info(color.dim('\n  shutting down…'));
    await wslog.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

main().catch((err: unknown) => {
  console.error(color.red(`✖ ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
