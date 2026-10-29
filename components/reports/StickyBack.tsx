'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The back control, pinned under the app header while the page scrolls.
 *
 * Not `position: sticky`. That only works when every ancestor between the bar and
 * the scroller cooperates, and the app shell (WorkspaceChrome: an overflow:hidden
 * 100dvh column whose <main> scrolls) is exactly where it has failed to hold on
 * phones, in the installed app. A `position: fixed` bar does not depend on which
 * element scrolls: it is placed at the top edge of <main> (measured, so the header's
 * safe-area padding and a wrapped header are both accounted for) and a spacer of the
 * same height keeps the content from sliding under it.
 *
 * Re-measured on resize / rotation and whenever <main> changes size (e.g. a banner
 * appears above it). Side padding honours the landscape safe areas.
 */
export default function StickyBack({ children, maxWidth = 720 }: { children: ReactNode; maxWidth?: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(48);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const main = bar.closest('main');
    const measure = () => {
      setTop(main ? Math.max(0, Math.round(main.getBoundingClientRect().top)) : 0);
      setHeight(bar.offsetHeight || 48);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (main) ro?.observe(main);
    ro?.observe(bar);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <>
      {/* In-flow spacer: reserves the bar's height. The -20px cancels the page's top padding so
          the bar covers it instead of leaving a gap. */}
      <div aria-hidden style={{ height, margin: '-20px -16px 0' }} />
      <div
        ref={barRef}
        data-report-back
        style={{
          position: 'fixed',
          top,
          left: 0,
          right: 0,
          zIndex: 40,
          paddingLeft: 'max(16px, env(safe-area-inset-left))',
          paddingRight: 'max(16px, env(safe-area-inset-right))',
          background: 'var(--cl-bg-primary)',
          borderBottom: '1px solid var(--cl-border-subtle)',
        }}
      >
        <div style={{ maxWidth, margin: '0 auto' }}>{children}</div>
      </div>
    </>
  );
}
