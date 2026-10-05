'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { FEATURES, type Feature } from '@/lib/entitlements';
import { getPlan, type PlanId } from '@/lib/plans';

/**
 * "This is part of Pro" sheet, opened when a coach presses a locked tool
 * (toolbar rows carry the lock; lib/entitlements.ts decides). Bottom sheet on
 * phones, centred card on wider screens. Esc, the backdrop and "Not now" close.
 */
export default function UpgradeSheet({ feature, onClose }: { feature: Feature | null; onClose: () => void }) {
  const primaryRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!feature) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feature, onClose]);

  if (!feature) return null;
  const f = FEATURES[feature];
  const plan = f.plan as PlanId;
  const planName = getPlan(plan)?.name ?? 'Plans';
  const plans = plan === 'pro' ? 'Pro and Academy' : plan === 'academy' ? 'Academy' : 'every plan';

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-sheet-title"
        data-upgrade-sheet={feature}
        onClick={(e) => e.stopPropagation()}
        className="am-upgrade-sheet"
        style={{
          width: 'min(440px, 100%)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)',
          borderRadius: '16px 16px 0 0', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.25)', fontFamily: 'var(--cl-font, inherit)',
        }}
      >
        <style>{`@media (min-width: 640px) { .am-upgrade-sheet { border-radius: 16px !important; margin-bottom: 18vh; } }`}</style>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cl-text-secondary)' }}>
          {planName}
        </div>
        <h2 id="upgrade-sheet-title" style={{ margin: '6px 0 8px', fontSize: 19, fontWeight: 800, lineHeight: 1.25 }}>
          {f.label} is part of {plans}.
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>
          Your current plan doesn’t include it. Everything you’ve made stays where it is.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            ref={primaryRef}
            href={`/pricing?required=${f.plan}&feature=${feature}`}
            style={{
              flex: 1, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 10, background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)',
              fontWeight: 700, fontSize: 14, textDecoration: 'none', padding: '0 16px',
            }}
          >
            See plans
          </Link>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: 44, borderRadius: 10, border: '1px solid var(--cl-border)', background: 'transparent',
              color: 'var(--cl-text-primary)', fontWeight: 600, fontSize: 14, padding: '0 16px', cursor: 'pointer',
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
