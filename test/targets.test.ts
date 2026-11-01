import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWslog } from './helpers/ws.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wslog-targets-'));
  dirs.push(dir);
  return join(dir, 'nested', 'targets.json');
}

describe('targetsFile', () => {
  it('remembers targets across restarts, so proxy URLs keep working', async () => {
    const targetsFile = tempFile();
    const first = await startWslog({ targetsFile });
    const kept = first.ctx.targets.add('ws://127.0.0.1:8080/socket');
    const removed = first.ctx.targets.add('ws://127.0.0.1:9090');
    first.ctx.targets.add('ws://127.0.0.1:7070', { demo: true });
    first.ctx.targets.remove(removed.id);
    await first.close();

    expect(JSON.parse(readFileSync(targetsFile, 'utf8'))).toEqual({ targets: ['ws://127.0.0.1:8080/socket'] });
    expect(statSync(targetsFile).mode & 0o777).toBe(0o600);

    const second = await startWslog({ targetsFile });
    expect(second.ctx.targets.list().map((t) => t.proxyPath)).toEqual([kept.proxyPath]);
    await second.close();
  });

  it('starts anyway when the file is unreadable', async () => {
    const targetsFile = tempFile();
    const first = await startWslog({ targetsFile });
    first.ctx.targets.add('ws://127.0.0.1:8080');
    await first.close();
    writeFileSync(targetsFile, '{ not json');

    const second = await startWslog({ targetsFile, targets: ['ws://127.0.0.1:9000'] });
    expect(second.ctx.targets.list().map((t) => t.url)).toEqual(['ws://127.0.0.1:9000/']);
    await second.close();
  });

  it('tightens an existing file and never logs a saved URL, which may hold credentials', async () => {
    const targetsFile = tempFile();
    mkdirSync(dirname(targetsFile), { recursive: true });
    writeFileSync(targetsFile, JSON.stringify({ targets: ['ftp://ada:pw-secret@host/?token=url-secret'] }), { mode: 0o644 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const wslog = await startWslog({ targetsFile, logLevel: 'error' });
      wslog.ctx.targets.add('ws://127.0.0.1:8080');
      await wslog.close();
      const logged = errors.mock.calls.flat().join(' ');
      expect(logged).toContain('Skipping saved target #1');
      expect(logged).not.toMatch(/pw-secret|url-secret/);
    } finally {
      errors.mockRestore();
    }
    expect(statSync(targetsFile).mode & 0o777).toBe(0o600);
  });
});
