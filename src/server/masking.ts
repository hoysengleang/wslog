export const MASK = '***';

export interface Masker {
  readonly fields: readonly string[];
  /** Mask a text payload. JSON is masked structurally; other text by `key=value` / `"key": "value"` patterns. */
  text(input: string): string;
  /** Mask query parameters in a URL or path. A password in the URL (`ws://user:pw@host`) is always hidden. */
  url(input: string): string;
}

const identity: Masker = { fields: [], text: (s) => s, url: (s) => redactUrlPassword(s) };

/**
 * Longest backslash run treated as JSON escaping. Each nesting level of
 * JSON-in-a-string doubles it (1, 3, 7, 15, 31), so 31 covers five levels.
 * Bounding it keeps masking linear: an unbounded run made it quadratic, and
 * one 100 KB message stalled the proxy for seconds.
 */
const MAX_ESCAPE_RUN = 31;

export function createMasker(fields: readonly string[]): Masker {
  const keys = new Set(fields.map((f) => f.toLowerCase()).filter(Boolean));
  if (keys.size === 0) return identity;

  const isMasked = (key: string) => keys.has(key.toLowerCase());
  const alternation = [...keys].map(escapeRegExp).join('|');
  // "token": "abc"   'token': 'abc'   "token": 123
  const quotedPattern = new RegExp(`(["'](?:${alternation})["']\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^,}\\]\\s]+)`, 'gi');
  // token=abc   token: abc
  const plainPattern = new RegExp(`(\\b(?:${alternation})\\s*[=:]\\s*)([^\\s&,;"'}\\]]+)`, 'gi');
  // \"token\":\"abc\"   JSON escaped inside a string, any depth (the backslash run must repeat).
  // The run must start at a non-backslash, so a long run is tried once, not from every position.
  const escapedPattern = new RegExp(
    `(?<!\\\\)((\\\\{1,${MAX_ESCAPE_RUN}})"(?:${alternation})\\2"\\s*:\\s*)(\\2"(?:(?!\\2").)*\\2"|[^,}\\]\\s\\\\]+)`,
    'gi',
  );

  function maskValue(value: unknown): unknown {
    if (isRawJson(value)) return value;
    if (Array.isArray(value)) return value.map(maskValue);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = isMasked(k) ? MASK : maskValue(v);
      return out;
    }
    // Strings can carry secrets too: JSON-encoded payloads (echoes, envelopes) and URLs.
    if (typeof value === 'string') return maskText(value);
    return value;
  }

  function maskText(input: string): string {
    const json = maskJson(input);
    if (json !== undefined) return json;
    return input
      .replace(escapedPattern, (_m, prefix: string, slashes: string) => `${prefix}${slashes}"${MASK}${slashes}"`)
      .replace(quotedPattern, (_m, prefix: string) => `${prefix}"${MASK}"`)
      .replace(plainPattern, (_m, prefix: string) => `${prefix}${MASK}`);
  }

  function maskJson(input: string): string | undefined {
    const first = input.trimStart()[0];
    if (first !== '{' && first !== '[') return undefined;
    try {
      const parsed = parseLossless(input);
      const masked = JSON.stringify(maskValue(parsed));
      // Keep the original formatting when nothing needed masking.
      return masked === JSON.stringify(parsed) ? input : masked;
    } catch {
      return undefined;
    }
  }

  return {
    fields: [...keys],
    text: maskText,
    url(input) {
      const redacted = redactUrlPassword(input);
      const qIndex = redacted.indexOf('?');
      if (qIndex === -1) return redacted;
      const params = new URLSearchParams(redacted.slice(qIndex + 1));
      let changed = false;
      for (const key of [...params.keys()]) {
        if (isMasked(key)) {
          params.set(key, MASK);
          changed = true;
        }
      }
      return changed ? `${redacted.slice(0, qIndex)}?${params.toString()}` : redacted;
    },
  };
}

/** `ws://user:secret@host/x` → `ws://user:***@host/x`. */
export function redactUrlPassword(input: string): string {
  return input.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]*:)[^/?#@]*@/i, `$1${MASK}@`);
}

// `JSON.rawJSON` keeps a number's exact source text through parse → stringify
// (Node 21+). Without it, 12345678901234567890 would be stored as 12345678901234567000.
const jsonExt = JSON as unknown as { rawJSON?: (text: string) => unknown; isRawJSON?: (value: unknown) => boolean };
const isRawJson = (value: unknown): boolean => jsonExt.isRawJSON?.(value) ?? false;
/** A run this long may be a number that does not survive a double round trip. */
const MAYBE_LOSSY_NUMBER = /\d[\d.eE+-]{15}/;

/** JSON.parse, but numbers keep their exact text. Throws (→ text masking) if that is not possible. */
function parseLossless(input: string): unknown {
  if (!MAYBE_LOSSY_NUMBER.test(input)) return JSON.parse(input);
  const { rawJSON } = jsonExt;
  if (!rawJSON) throw new Error('JSON.rawJSON is not available');
  return JSON.parse(input, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source !== undefined && JSON.stringify(value) !== context.source ? rawJSON(context.source) : value,
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
