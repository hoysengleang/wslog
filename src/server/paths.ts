import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Package root, from both `src/server/` (tsx) and `dist/server/` (built). */
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

export const defaultWebRoot = join(packageRoot, 'dist', 'web');

/** Where the CLI remembers targets between runs. */
export function defaultTargetsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'wslog', 'targets.json');
}

export function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
