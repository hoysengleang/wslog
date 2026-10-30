import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface Options {
  count: number;
  rowHeight: number;
  overscan?: number;
  /** Keep the view pinned to the newest row while the user is at the bottom. */
  follow: boolean;
  onFollowChange(follow: boolean): void;
}

/**
 * Fixed-height row virtualization: only rows in view (plus overscan) are
 * rendered, so the table stays fast with tens of thousands of messages.
 */
export function useVirtualRows({ count, rowHeight, overscan = 12, follow, onFollowChange }: Options) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Stick to the bottom as rows arrive.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !follow) return;
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, [count, follow, height]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight;
    if (atBottom !== follow) onFollowChange(atBottom);
  }, [follow, onFollowChange, rowHeight]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el) return;
      const top = index * rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
    },
    [rowHeight],
  );

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  return { ref, onScroll, start, end, totalHeight: count * rowHeight, scrollToIndex };
}
