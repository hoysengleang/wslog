import { describe, expect, it } from 'vitest';
import { createMasker, MASK } from '../src/server/masking.js';

describe('createMasker', () => {
  const masker = createMasker(['token', 'Password']);

  it('masks JSON fields at any depth, case-insensitively', () => {
    const input = JSON.stringify({ token: 'a', user: { PASSWORD: 'b', name: 'c' }, list: [{ token: 1 }] });
    expect(JSON.parse(masker.text(input))).toEqual({ token: MASK, user: { PASSWORD: MASK, name: 'c' }, list: [{ token: MASK }] });
  });

  it('keeps JSON formatting when nothing is masked', () => {
    const input = '{ "hello":   "world" }';
    expect(masker.text(input)).toBe(input);
  });

  it('masks key=value and quoted pairs in non-JSON text', () => {
    expect(masker.text('login token=abc123&user=x')).toBe(`login token=${MASK}&user=x`);
    expect(masker.text('partial {"password": "hunter2", "a": 1')).toBe(`partial {"password": "${MASK}", "a": 1`);
  });

  it('masks inside JSON-encoded strings and URLs nested in JSON values', () => {
    const echo = JSON.stringify({ type: 'echo', data: JSON.stringify({ token: 'abc123', user: 'ada' }) });
    const masked = JSON.parse(masker.text(echo)) as { data: string };
    expect(JSON.parse(masked.data)).toEqual({ token: MASK, user: 'ada' });

    const twice = JSON.stringify({ outer: JSON.stringify({ inner: JSON.stringify({ password: 'hunter2' }) }) });
    expect(masker.text(twice)).not.toContain('hunter2');

    expect(JSON.parse(masker.text('{"url":"wss://x/ws?token=abc123&room=1"}'))).toEqual({ url: `wss://x/ws?token=${MASK}&room=1` });
  });

  it('masks escaped JSON inside non-JSON text, e.g. Socket.IO frames', () => {
    expect(masker.text('42["echo","{\\"token\\":\\"abc123\\",\\"n\\":1}"]')).toBe(`42["echo","{\\"token\\":\\"${MASK}\\",\\"n\\":1}"]`);
    expect(masker.text('x \\\\\\"password\\\\\\": \\\\\\"hunter2\\\\\\"')).not.toContain('hunter2');
  });

  it('masks URL query params', () => {
    expect(masker.url('/p/abc?token=s3cret&room=1')).toBe(`/p/abc?token=${encodeURIComponent(MASK)}&room=1`);
    expect(masker.url('/p/abc')).toBe('/p/abc');
  });

  it('is a no-op without fields', () => {
    const none = createMasker([]);
    expect(none.text('{"token":"x"}')).toBe('{"token":"x"}');
  });

  it('always hides passwords in URLs, with or without fields', () => {
    expect(createMasker([]).url('ws://ada:pw@host:1/ws')).toBe(`ws://ada:${MASK}@host:1/ws`);
    expect(masker.url('wss://ada:pw@host/ws?token=a&b=1')).toBe(`wss://ada:${MASK}@host/ws?token=${MASK}&b=1`);
    expect(masker.url('ws://host/ws?next=http://x:y@z')).toBe('ws://host/ws?next=http://x:y@z');
  });

  it('keeps numbers exact when it masks (no 12345678901234567890 → …000)', () => {
    const input = '{"token":"t","userId":12345678901234567890,"f":0.1000000000000000055511151231257827,"n":-0}';
    expect(masker.text(input)).toBe(`{"token":"${MASK}","userId":12345678901234567890,"f":0.1000000000000000055511151231257827,"n":-0}`);
  });

  it('stays linear on hostile input, so one message cannot stall the proxy', () => {
    const hostile = [
      '\\'.repeat(200_000) + '"token"',
      '\\'.repeat(30) + '"token' + '\\'.repeat(30) + '":' + '\\'.repeat(30) + '"' + ('\\'.repeat(29) + '"').repeat(6000),
      '"token":"\\",'.repeat(20_000),
    ];
    for (const input of hostile) {
      const start = performance.now();
      masker.text(input);
      expect(performance.now() - start).toBeLessThan(500);
    }
  });
});
