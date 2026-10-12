'use client';

import Link from 'next/link';
import { FEATURES, requiredPlan, type Feature } from '@/lib/entitlements';
import { getPlan } from '@/lib/plans';

/**
 * Inline "read-only on your plan" strip for pages that stay open after a
 * downgrade (e.g. /players): saved data stays readable, edits need the plan
 * named here. The server enforces it (403 plan_required); this only explains.
 */
export default function PlanLockedNotice({ feature, children }: { feature: Feature; children?: React.ReactNode }) {
  const f = FEATURES[feature];
  const planName = getPlan(requiredPlan(feature))?.name ?? 'a paid plan';
  return (
    <div
      role="status"
      data-plan-locked={feature}
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, padding: '12px 14px', borderRadius: 12,
        background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)',
        color: 'var(--cl-text-primary)', fontSize: 13, lineHeight: 1.5,
      }}
    >
      <span style={{ flex: '1 1 240px' }}>
        {children ?? <>{f.label} is part of {planName}. Your saved data stays readable.</>}
      </span>
      <Link
        href={`/pricing?required=${f.plan}&feature=${feature}`}
        style={{
          minHeight: 40, display: 'inline-flex', alignItems: 'center', padding: '0 14px', borderRadius: 10,
          background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)', fontWeight: 700,
          textDecoration: 'none', fontSize: 13,
        }}
      >
        See plans
      </Link>
    </div>
  );
}
