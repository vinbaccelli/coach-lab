'use client';

import type { ReactNode } from 'react';

/**
 * The back control, pinned to the top of the scrolling page so it is reachable from
 * anywhere in a long report. The app shell (WorkspaceChrome) scrolls its content
 * area under a fixed header, so `top: 0` is directly under that header, which
 * already clears the iPhone notch. Side padding honours the landscape safe areas.
 */
export default function StickyBack({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        margin: '0 -16px',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
        background: 'var(--cl-bg-primary)',
        borderBottom: '1px solid var(--cl-border-subtle)',
      }}
    >
      {children}
    </div>
  );
}
