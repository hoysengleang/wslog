import { useState } from 'react';
import { tryParseJson } from '../lib/format';
import { IconChevron } from './icons';

/** Children rendered per object/array before a "show more" button. */
const PAGE = 200;

interface Props {
  value: unknown;
  /** Levels expanded by default. */
  expandDepth?: number;
}

export function JsonTree({ value, expandDepth = 2 }: Props) {
  return (
    <div className="json-tree mono" role="tree">
      <JsonNode name={null} value={value} depth={0} expandDepth={expandDepth} />
    </div>
  );
}

interface NodeProps {
  name: string | number | null;
  value: unknown;
  depth: number;
  expandDepth: number;
}

function JsonNode({ name, value: raw, depth, expandDepth }: NodeProps) {
  // A string that holds JSON (an echo, an envelope) is shown as the tree it encodes.
  const parsed = typeof raw === 'string' ? tryParseJson(raw) : undefined;
  const encoded = parsed?.ok === true;
  const value = parsed?.ok ? parsed.value : raw;
  const isContainer = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < expandDepth);
  const [limit, setLimit] = useState(PAGE);

  const label = name === null ? null : <span className="json-key">{typeof name === 'number' ? name : `"${name}"`}</span>;

  if (!isContainer) {
    return (
      <div className="json-row" style={{ paddingLeft: depth * 14 + 16 }}>
        {label}
        {label && <span className="json-punct">: </span>}
        <JsonValue value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string | number, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const [openBrace, closeBrace] = isArray ? ['[', ']'] : ['{', '}'];

  return (
    <div role="treeitem" aria-expanded={open}>
      <div className="json-row json-toggle" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen(!open)}>
        <IconChevron className={`json-chevron${open ? ' open' : ''}`} width={12} height={12} />
        {label}
        {label && <span className="json-punct">: </span>}
        {encoded && (
          <span className="json-encoded" title="This value is a string of JSON, shown decoded. Raw shows it as sent.">
            JSON string
          </span>
        )}
        <span className="json-punct">{openBrace}</span>
        {!open && (
          <>
            <span className="json-summary">{isArray ? `${entries.length} items` : `${entries.length} keys`}</span>
            <span className="json-punct">{closeBrace}</span>
          </>
        )}
      </div>
      {open && (
        <>
          {entries.slice(0, limit).map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} expandDepth={expandDepth} />
          ))}
          {entries.length > limit && (
            <button type="button" className="json-more" style={{ marginLeft: (depth + 1) * 14 + 16 }} onClick={() => setLimit(limit + PAGE)}>
              show {Math.min(PAGE, entries.length - limit)} more of {entries.length - limit}
            </button>
          )}
          <div className="json-row json-punct" style={{ paddingLeft: depth * 14 + 16 }}>
            {closeBrace}
          </div>
        </>
      )}
    </div>
  );
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  switch (typeof value) {
    case 'string':
      return <span className="json-string">{JSON.stringify(value)}</span>;
    case 'number':
      return <span className="json-number">{String(value)}</span>;
    case 'boolean':
      return <span className="json-boolean">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}
