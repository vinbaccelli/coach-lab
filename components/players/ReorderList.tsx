'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { moveItem } from '@/lib/players/reorder';

/** The element that scrolls this list: the nearest ancestor with its own vertical scroll, else the page. */
function scrollParent(el: HTMLElement | null): Element {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Drag-to-reorder list that works with touch (iPhone) and mouse. Only the grip handle starts a drag,
 * so scrolling the page and tapping inputs keep working. Items swap live as the pointer crosses them;
 * the new order is reported once, when the finger lifts. Works for a grid too (hit-test is 2-D).
 */
export default function ReorderList<T>({
  items, getKey, onReorder, renderItem, disabled, containerStyle, itemStyle,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  disabled?: boolean;
  containerStyle?: CSSProperties;
  /** Extra style for one item's wrapper (e.g. span all grid columns). */
  itemStyle?: (item: T) => CSSProperties | undefined;
}) {
  const [order, setOrder] = useState<T[] | null>(null); // live order while dragging
  const [dragKey, setDragKey] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const live = order ?? (items as T[]);
  const liveRef = useRef<T[]>(live);
  liveRef.current = live;

  const targetIndexAt = (x: number, y: number): number => {
    let best = -1, bestD = Infinity;
    liveRef.current.forEach((it, i) => {
      const el = refs.current.get(getKey(it));
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { best = i; bestD = -1; return; }
      if (bestD < 0) return;
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  // The dragged row is re-ordered in the DOM while dragging, which drops pointer capture; so the
  // move / up events are listened for on the window for the length of one drag instead.
  const start = (key: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (disabled) return;
    e.preventDefault();
    setDragKey(key);
    setOrder(items.slice());
    liveRef.current = items.slice();
    let px = e.clientX, py = e.clientY, raf = 0;
    const moveTo = (x: number, y: number) => {
      const cur = liveRef.current;
      const from = cur.findIndex((i) => getKey(i) === key);
      const to = targetIndexAt(x, y);
      if (from < 0 || to < 0 || from === to) return;
      const next = moveItem(cur, from, to);
      liveRef.current = next;
      setOrder(next);
    };
    const onMove = (ev: PointerEvent) => { px = ev.clientX; py = ev.clientY; moveTo(px, py); };
    // Rows can be taller than a phone screen (charts, videos): holding the finger near the top or
    // bottom edge scrolls the page's scroll area, so a row can be carried past what is visible.
    const scroller = scrollParent(refs.current.get(key) ?? null);
    const EDGE = 72;
    const tick = () => {
      const top = scroller === document.scrollingElement ? 0 : (scroller as HTMLElement).getBoundingClientRect().top;
      const bottom = scroller === document.scrollingElement ? window.innerHeight : (scroller as HTMLElement).getBoundingClientRect().bottom;
      let dy = 0;
      if (py < top + EDGE) dy = -Math.ceil((top + EDGE - py) / 3);
      else if (py > bottom - EDGE) dy = Math.ceil((py - (bottom - EDGE)) / 3);
      if (dy) { scroller.scrollBy(0, dy); moveTo(px, py); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const finish = (commit: boolean) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      const next = liveRef.current;
      const changed = next.length === items.length && next.some((it, i) => getKey(it) !== getKey(items[i]));
      setDragKey(null);
      setOrder(null);
      if (commit && changed) onReorder(next.slice());
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  return (
    <div style={containerStyle}>
      {live.map((it, i) => {
        const key = getKey(it);
        const handle = disabled ? null : (
          <span
            role="button"
            aria-label="Drag to reorder"
            onPointerDown={start(key)}
            style={{ touchAction: 'none', cursor: dragKey === key ? 'grabbing' : 'grab', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 34, color: 'var(--cl-text-muted)', userSelect: 'none', flexShrink: 0 }}
          >
            <GripVertical size={16} />
          </span>
        );
        return (
          <div
            key={key}
            ref={(el) => { if (el) refs.current.set(key, el); else refs.current.delete(key); }}
            style={{ opacity: dragKey === key ? 0.6 : 1, background: dragKey === key ? 'rgba(0,122,255,0.06)' : undefined, borderRadius: 10, ...itemStyle?.(it) }}
          >
            {renderItem(it, i, handle)}
          </div>
        );
      })}
    </div>
  );
}
