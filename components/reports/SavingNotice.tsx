'use client';

import { useEffect, useState } from 'react';

/** How long a save may run before the coach is told it is still going. */
export const SLOW_SAVE_MS = 20_000;

/**
 * "Saving…" while a save runs, and — after 20 s — a plain instruction not to close
 * the page. A slow first save (a brand-new player makes the server build the Drive
 * folders) looked frozen, so the coach closed the tab and retried. While mounted it
 * also asks the browser to confirm before the tab is closed or reloaded.
 */
export default function SavingNotice({ label = 'Saving…', slowAfterMs = SLOW_SAVE_MS }: { label?: string; slowAfterMs?: number }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeunload', guard);
    };
  }, [slowAfterMs]);

  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="animate-spin"
          aria-hidden
          style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, border: '2px solid rgba(0,122,255,0.3)', borderTopColor: '#007AFF' }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0A58C9' }}>{label}</span>
      </div>
      {slow ? (
        <span style={{ fontSize: 13, lineHeight: 1.4, color: '#1D1D1F' }}>
          Still saving, please keep this page open. The first save for a new player takes longer.
        </span>
      ) : null}
    </div>
  );
}
