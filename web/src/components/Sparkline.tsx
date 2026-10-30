import { RATE_WINDOW } from '../state/store';

const EMPTY: number[] = [];

/** Messages per second over the last 30 seconds. */
export function Sparkline({ values = EMPTY, width = 64, height = 18 }: { values?: number[]; width?: number; height?: number }) {
  const peak = Math.max(0, ...values);
  const max = Math.max(1, peak);
  const step = width / (RATE_WINDOW - 1);
  const offset = RATE_WINDOW - values.length;
  const points = values.map((v, i) => `${((offset + i) * step).toFixed(1)},${(height - 1 - (v / max) * (height - 2)).toFixed(1)}`);
  const last = values.at(-1) ?? 0;
  return (
    <span className="sparkline" title={`${last} msg/s now · peak ${peak} msg/s`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="sparkline-base" />
        {points.length > 1 && <polyline points={points.join(' ')} className="sparkline-line" />}
      </svg>
    </span>
  );
}
