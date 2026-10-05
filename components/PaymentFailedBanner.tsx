'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * "Payment failed — update your card" pill, shown while the coach's
 * subscription is past_due (Stripe is retrying; access is kept meanwhile —
 * lib/entitlements.ts). Opens the Stripe customer portal. Same position and
 * shape as TrialBanner; the two never show together (a trial means no plan).
 */
export default function PaymentFailedBanner({ inline = false }: {
  /** In page chrome: a full-width strip in the flow under the header. Default: a
   *  floating pill (the analysis canvas, where nothing may shift the layout). */
  inline?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/entitlement', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((e: { paymentFailed?: boolean } | null) => { if (!cancelled) setShow(!!e?.paymentFailed); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const openPortal = useCallback(async () => {
    setOpening(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { url?: string };
      window.location.href = body.url ?? '/billing';
    } catch {
      window.location.href = '/billing';
    }
  }, []);

  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => void openPortal()}
      disabled={opening}
      role="alert"
      style={inline ? {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 8,
        width: '100%',
        minHeight: 40,
        padding: '8px 16px',
        border: 'none',
        background: 'rgba(120,20,16,0.95)',
        color: 'var(--cl-text-on-fill)',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        flexShrink: 0,
      } : {
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
        background: 'rgba(120,20,16,0.92)',
        border: '1px solid rgba(255,255,255,0.25)',
        color: 'var(--cl-text-on-fill)',
        fontSize: 12.5,
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <span>Payment failed —</span>
      <span style={{ fontWeight: 600 }}>{opening ? 'Opening…' : 'Update your card →'}</span>
    </button>
  );
}
