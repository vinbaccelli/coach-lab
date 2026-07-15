'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Floating free-trial countdown pill. Fixed-position so it never disturbs the
 * full-height analysis canvas layout. Hidden for subscribers/admins and for
 * anyone without an active trial. When the hour runs out it sends the coach to
 * pricing (the middleware gate enforces the same on the next navigation).
 */
export default function TrialBanner() {
  const router = useRouter();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  // Fetch the authoritative clock on mount and resync every 2 minutes.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/trial/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { state: string; remainingMs?: number };
        if (cancelled) return;
        if (data.state === 'active' && typeof data.remainingMs === 'number') {
          setRemainingMs(data.remainingMs);
        } else if (data.state === 'expired') {
          setRemainingMs(0);
        } else {
          setRemainingMs(null); // subscribed / none → no pill
        }
      } catch {
        /* ignore — pill just stays hidden */
      }
    };
    void load();
    const resync = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(resync); };
  }, []);

  // Local 1s tick so the countdown feels live between resyncs.
  useEffect(() => {
    if (remainingMs === null || remainingMs <= 0) return;
    const t = setInterval(() => {
      setRemainingMs((prev) => (prev === null ? null : Math.max(0, prev - 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [remainingMs]);

  // Expiry → pricing.
  useEffect(() => {
    if (remainingMs === 0) router.push('/pricing?required=1');
  }, [remainingMs, router]);

  if (remainingMs === null || remainingMs <= 0) return null;

  const totalMin = Math.floor(remainingMs / 60_000);
  const sec = Math.floor((remainingMs % 60_000) / 1000);
  const label = totalMin >= 1
    ? `${totalMin} min left`
    : `${sec}s left`;

  return (
    <a
      href="/pricing"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.18)',
        color: '#fff',
        fontSize: 12.5,
        fontWeight: 700,
        textDecoration: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>⏱</span>
      <span>Free trial · {label}</span>
      <span style={{ color: '#0A84FF' }}>Subscribe →</span>
    </a>
  );
}
