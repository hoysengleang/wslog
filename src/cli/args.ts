import { parseArgs } from 'node:util';
import { DEFAULT_CONFIG, type WslogConfig } from '../server/config.js';
import { defaultTargetsFile } from '../server/paths.js';

export const HELP = `
wslog — record WebSocket traffic and watch it live in your browser

Usage
  wslog [target-url...] [options]

Examples
  wslog                          start the dashboard at http://localhost:4000
  wslog --demo                   start with a fake chat server to try it
  wslog ws://localhost:8080      register a target from the command line
  wslog ws://localhost:8080 ws://localhost:9000/socket
                                 proxy several servers at once
  wslog --mask token,password --store ./traffic.jsonl

Options
  -p, --port <n>           dashboard and proxy port (default ${DEFAULT_CONFIG.port})
  -H, --host <addr>        bind address (default ${DEFAULT_CONFIG.host}); use 0.0.0.0 only on a trusted network
      --public-url <url>   address people use to reach wslog, for printed and share links
                           (e.g. http://localhost:8080 when Docker maps port 8080)
  -m, --mask <fields>      comma-separated field names to hide, e.g. token,password (repeatable)
      --max-messages <n>   keep at most n messages, oldest dropped first (default ${DEFAULT_CONFIG.maxMessages})
      --max-payload <n>    keep at most n bytes per message (default ${DEFAULT_CONFIG.maxPayloadBytes})
      --store <spec>       memory (default), ./file.jsonl, or ./file.db (SQLite, Node 22.13+)
      --share-token <tok>  token for the read-only share link (default: random)
      --admin-token <tok>  token for full access from other machines (default: random)
      --demo               start a fake chat server with simulated users
  -o, --open               open the dashboard in your browser
      --verbose            debug logging
  -q, --quiet              only log errors
  -v, --version            print version
  -h, --help               show this help

Environment (handy for Docker; flags win)
  WSLOG_PORT, WSLOG_HOST, WSLOG_PUBLIC_URL, WSLOG_MASK, WSLOG_STORE,
  WSLOG_MAX_MESSAGES, WSLOG_SHARE_TOKEN, WSLOG_ADMIN_TOKEN, WSLOG_TARGET
  WSLOG_TARGETS_FILE       where targets are remembered between runs
                           (default ~/.config/wslog/targets.json; empty = don't remember)
`;

export interface CliOptions {
  config: Partial<WslogConfig>;
  open: boolean;
  help: boolean;
  version: boolean;
}

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string', short: 'H' },
      'public-url': { type: 'string' },
      mask: { type: 'string', short: 'm', multiple: true },
      'max-messages': { type: 'string' },
      'max-payload': { type: 'string' },
      store: { type: 'string' },
      'share-token': { type: 'string' },
      'admin-token': { type: 'string' },
      demo: { type: 'boolean' },
      open: { type: 'boolean', short: 'o' },
      verbose: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const mask = values.mask ?? (env.WSLOG_MASK ? [env.WSLOG_MASK] : undefined);
  const config: Partial<WslogConfig> = {
    port: toInt(values.port ?? env.WSLOG_PORT, '--port'),
    host: values.host ?? env.WSLOG_HOST,
    publicUrl: values['public-url'] ?? env.WSLOG_PUBLIC_URL,
    mask: mask?.flatMap((m) => m.split(',')),
    maxMessages: toInt(values['max-messages'] ?? env.WSLOG_MAX_MESSAGES, '--max-messages'),
    maxPayloadBytes: toInt(values['max-payload'], '--max-payload'),
    store: values.store ?? env.WSLOG_STORE,
    shareToken: values['share-token'] ?? env.WSLOG_SHARE_TOKEN,
    adminToken: values['admin-token'] ?? env.WSLOG_ADMIN_TOKEN,
    targets: positionals.length ? positionals : splitTargets(env.WSLOG_TARGET ?? ''),
    targetsFile: env.WSLOG_TARGETS_FILE ?? defaultTargetsFile(env),
    demo: values.demo,
    logLevel: values.quiet ? 'error' : values.verbose ? 'debug' : undefined,
  };

  return { config, open: Boolean(values.open), help: Boolean(values.help), version: Boolean(values.version) };
}

/**
 * `WSLOG_TARGET` may list several URLs, separated by spaces or commas. A comma
 * only splits when a new `scheme://` follows, so `ws://host/?topics=a,b` stays whole.
 */
export function splitTargets(value: string): string[] {
  return value.split(/\s+|,(?=\s*[a-z][a-z0-9+.-]*:\/\/)/i).filter(Boolean);
}

function toInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${flag} expects a whole number, got "${value}"`);
  return n;
}
