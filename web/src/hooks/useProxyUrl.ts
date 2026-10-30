import type { TargetInfo } from '../../../src/shared/protocol';
import { useStore } from '../state/store';

export function proxyUrlFor(base: string | undefined, target: TargetInfo | undefined): string | undefined {
  return base && target ? `${base}${target.proxyPath}` : undefined;
}

/** Proxy URL of the active target. */
export function useProxyUrl(): string | undefined {
  const base = useStore((s) => s.info?.proxyBaseUrl);
  const target = useStore((s) => s.targets.find((t) => t.id === s.activeTargetId));
  return proxyUrlFor(base, target);
}
