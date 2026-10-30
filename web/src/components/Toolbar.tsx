import type { Direction } from '../../../src/shared/protocol';
import { formatCount, shortId } from '../lib/format';
import { actions, useStore } from '../state/store';
import { IconArrowDown, IconSearch, IconX } from './icons';

const DIRECTIONS: Array<{ value: Direction | undefined; label: string; title: string }> = [
  { value: undefined, label: 'All', title: 'Both directions' },
  { value: 'out', label: '↑ Out', title: 'Sent by your app (client → server)' },
  { value: 'in', label: '↓ In', title: 'Received by your app (server → client)' },
];

interface Props {
  shown: number;
  follow: boolean;
  onFollow(): void;
}

export function Toolbar({ shown, follow, onFollow }: Props) {
  const filter = useStore((s) => s.filter);
  const total = useStore((s) => s.messages.length);

  return (
    <div className="toolbar">
      <label className="search">
        <IconSearch />
        <input
          type="search"
          className="input"
          placeholder="Search payloads…"
          aria-label="Search payloads"
          value={filter.q ?? ''}
          onChange={(e) => actions.setFilter({ q: e.target.value || undefined })}
        />
      </label>

      <div className="segmented" role="group" aria-label="Direction">
        {DIRECTIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            title={d.title}
            className={filter.direction === d.value ? 'active' : ''}
            aria-pressed={filter.direction === d.value}
            onClick={() => actions.setFilter({ direction: d.value })}
          >
            {d.label}
          </button>
        ))}
      </div>

      {filter.connectionId && (
        <button type="button" className="chip" onClick={() => actions.setFilter({ connectionId: undefined })} title="Show all connections">
          conn <span className="mono">{shortId(filter.connectionId)}</span>
          <IconX width={12} height={12} />
        </button>
      )}

      <span className="toolbar-count muted">
        {shown === total ? `${formatCount(total)} messages` : `${formatCount(shown)} of ${formatCount(total)}`}
      </span>

      {!follow && shown > 0 && (
        <button type="button" className="btn btn-small" onClick={onFollow} title="Jump to newest and follow">
          <IconArrowDown />
          <span>Latest</span>
        </button>
      )}
    </div>
  );
}
