import type { WslogConfig } from '../config.js';

export type LogLevel = WslogConfig['logLevel'];

export interface Logger {
  error(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  debug(message: string, ...rest: unknown[]): void;
}

const order: Record<LogLevel, number> = { silent: 0, error: 1, info: 2, debug: 3 };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export const color = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[39m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[39m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[39m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[39m` : s),
};

export function createLogger(level: LogLevel): Logger {
  const enabled = (l: LogLevel) => order[l] <= order[level];
  return {
    error: (m, ...r) => enabled('error') && console.error(color.red('✖'), m, ...r),
    info: (m, ...r) => enabled('info') && console.log(m, ...r),
    debug: (m, ...r) => enabled('debug') && console.log(color.dim(`[debug] ${m}`), ...r),
  };
}
