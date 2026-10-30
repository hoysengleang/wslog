import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli/args.js';
import { resolveConfig } from '../src/server/config.js';

describe('parseCliArgs', () => {
  it('parses flags and positional targets', () => {
    const { config, open } = parseCliArgs(['ws://localhost:8080', '-p', '5000', '--mask', 'token,password', '-m', 'secret', '--demo', '-o'], {});
    expect(config).toMatchObject({ port: 5000, mask: ['token', 'password', 'secret'], targets: ['ws://localhost:8080'], demo: true });
    expect(open).toBe(true);
  });

  it('falls back to environment variables, flags win', () => {
    const env = { WSLOG_PORT: '4500', WSLOG_MASK: 'apiKey', WSLOG_ADMIN_TOKEN: 'abc', WSLOG_TARGET: 'ws://x' };
    expect(parseCliArgs([], env).config).toMatchObject({ port: 4500, mask: ['apiKey'], adminToken: 'abc', targets: ['ws://x'] });
    expect(parseCliArgs(['--port', '1'], env).config.port).toBe(1);
  });

  it('accepts several targets from arguments or WSLOG_TARGET', () => {
    expect(parseCliArgs(['ws://a:1', 'ws://b:2'], {}).config.targets).toEqual(['ws://a:1', 'ws://b:2']);
    const env = { WSLOG_TARGET: ' ws://a:1/?topics=x,y, wss://b:2  localhost:3 ' };
    expect(parseCliArgs([], env).config.targets).toEqual(['ws://a:1/?topics=x,y', 'wss://b:2', 'localhost:3']);
  });

  it('takes the public URL from --public-url or WSLOG_PUBLIC_URL', () => {
    expect(parseCliArgs(['--public-url', 'http://localhost:8080'], {}).config.publicUrl).toBe('http://localhost:8080');
    expect(parseCliArgs([], { WSLOG_PUBLIC_URL: 'http://10.0.0.5:4000' }).config.publicUrl).toBe('http://10.0.0.5:4000');
    expect(resolveConfig({ publicUrl: 'http://localhost:8080/some/path' }).publicUrl).toBe('http://localhost:8080');
    expect(resolveConfig({ publicUrl: '' }).publicUrl).toBeUndefined();
    expect(() => resolveConfig({ publicUrl: 'ftp://x' })).toThrow(/http:\/\//);
    expect(() => resolveConfig({ publicUrl: 'not a url' })).toThrow(/public-url/);
  });

  it('rejects bad numbers and unknown flags', () => {
    expect(() => parseCliArgs(['--port', 'abc'], {})).toThrow(/whole number/);
    expect(() => parseCliArgs(['--nope'], {})).toThrow();
  });
});
