'use client';

/**
 * Pricing (`/pricing`).
 *
 * Design system: the APP's tokens and ramp (`--cl-*`, DESIGN.md "The Quiet
 * Instrument"), NOT the landing page's marketing scale. This page is reached
 * from inside the app as often as from marketing — WorkspaceChrome, the trial
 * banner, /billing and ControlPanelHome all link here, and the middleware
 * subscription gate redirects here — so it has to sit comfortably beside app
 * chrome. The landing page keeps its own louder pricing section and links here
 * to close.
 *
 * Prices, copy and feature lists all come from lib/plans.ts, which the landing
 * page renders too. Neither surface hardcodes a price.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import {
  PLANS,
  DEMO,
  FOUNDING_NOTE,
  PRICING_HEADLINE,
  PRICING_SUBHEAD,
  PRICING_FOOTNOTE,
  planPrice,
  yearlyPerMonth,
  type PlanId,
  type BillingCycle,
} from '@/lib/plans';

const INK = 'var(--cl-text-primary)';
const MUTED = 'var(--cl-text-secondary)';
const ACCENT = 'var(--cl-accent)';

export default function PricingPage() {
  /* Annual is the default: it is the better deal on every tier and the only
     cycle that carries the Pro ebook. Monthly stays one tap away. */
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [loading, setLoading] = useState<PlanId | null>(null);
  // Set when the middleware subscription gate redirected here from /analysis.
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  useEffect(() => {
    setSubscriptionRequired(new URLSearchParams(window.location.search).get('required') === '1');
  }, []);

  const handleCheckout = async (plan: PlanId) => {
    setLoading(plan);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, cycle }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to create checkout');
        setLoading(null);
      }
    } catch {
      alert('Something went wrong');
      setLoading(null);
    }
  };

  const annual = cycle === 'yearly';

  return (
    // Own scroll container — globals.css locks body overflow for the canvas app.
    <div style={{
      height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      background: 'var(--cl-bg-primary)', color: INK, fontFamily: 'var(--cl-font)',
    }}>
      <style>{PAGE_CSS}</style>

      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', borderBottom: '1px solid var(--cl-border-subtle)',
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, textDecoration: 'none' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-square-new.jpg" alt="" style={{ width: 28, height: 28, borderRadius: 'var(--cl-radius-sm)' }} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>AngleMotion</span>
        </Link>
        <Link href="/login" style={{
          display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 14px',
          fontSize: 13, fontWeight: 600, color: INK, textDecoration: 'none',
          borderRadius: 10, border: '1px solid var(--cl-border)',
        }}>
          Sign in
        </Link>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '52px 20px 72px', textAlign: 'center' }}>
        {subscriptionRequired && (
          <div style={{
            margin: '0 auto 28px', maxWidth: 560, padding: '12px 18px', borderRadius: 10,
            background: '#FFF7ED', border: '1px solid #FCA5A5', color: '#9A3412',
            fontSize: 13, fontWeight: 600,
          }}>
            Video Analysis requires an active plan — pick one below to unlock it.
          </div>
        )}

        <h1 style={{
          margin: '0 auto 10px', maxWidth: 720,
          fontSize: 'clamp(32px, 6vw, 56px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em',
        }}>
          {PRICING_HEADLINE}
        </h1>
        <p style={{ margin: '0 auto 22px', maxWidth: 620, fontSize: 15, lineHeight: 1.6, color: MUTED }}>
          {PRICING_SUBHEAD}
        </p>

        {/* Founding promise — account-wide, whichever tier you join at, so it is
            stated once here rather than repeated on every card. */}
        <div style={{
          display: 'inline-flex', alignItems: 'flex-start', gap: 8, textAlign: 'left',
          margin: '0 auto 26px', padding: '10px 14px', borderRadius: 10,
          background: 'var(--cl-accent-soft)', maxWidth: 560,
        }}>
          <Lock size={14} style={{ color: ACCENT, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{FOUNDING_NOTE}</span>
        </div>

        {/* Billing toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <div
            role="group"
            aria-label="Billing period"
            style={{ display: 'inline-flex', background: 'var(--cl-bg-secondary)', borderRadius: 999, padding: 4 }}
          >
            <button type="button" onClick={() => setCycle('yearly')} aria-pressed={annual} style={toggleBtn(annual)}>
              Yearly
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, opacity: annual ? 0.9 : 1, color: annual ? 'var(--cl-text-on-fill)' : ACCENT }}>
                2 months free
              </span>
            </button>
            <button type="button" onClick={() => setCycle('monthly')} aria-pressed={!annual} style={toggleBtn(!annual)}>
              Monthly
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="pr-plans">
          {PLANS.map((plan) => {
            const price = planPrice(plan, cycle);
            return (
              <div
                key={plan.id}
                className="pr-plan"
                style={{
                  background: 'var(--cl-bg-panel)',
                  border: plan.featured ? `2px solid ${ACCENT}` : '1px solid var(--cl-border)',
                  borderRadius: 16,
                  padding: plan.featured ? 25 : 26,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>{plan.name}</span>
                  {plan.featured && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.02em',
                      /* Action Primary, not accent: white on System Blue is
                         4.02:1 and this is 10px. */
                      background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)',
                      padding: '3px 8px', borderRadius: 999,
                    }}>
                      MOST POPULAR
                    </span>
                  )}
                  {plan.seats > 1 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>up to {plan.seats} coaches</span>
                  )}
                </div>

                <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px', lineHeight: 1.5, minHeight: 39 }}>
                  {plan.tagline}
                </p>

                {/* Ink, not accent: System Blue at 11px is ~4.0:1 on white,
                    under the 4.5 floor (docs/KNOWN_ISSUES.md 001). */}
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: INK, marginBottom: 2 }}>
                  FOUNDING PRICE
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="pr-num" style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em' }}>
                    ${price}
                  </span>
                  <span style={{ fontSize: 15, color: MUTED }}>{annual ? '/year' : '/month'}</span>
                </div>
                <p className="pr-num" style={{ fontSize: 12, color: MUTED, margin: '4px 0 18px', minHeight: 16 }}>
                  {annual
                    ? `$${yearlyPerMonth(plan)}/mo · two months free`
                    : 'Billed monthly · cancel anytime'}
                </p>

                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={() => handleCheckout(plan.id)}
                  style={{
                    width: '100%', minHeight: 44, borderRadius: 10, border: 'none',
                    background: plan.featured ? ACCENT : 'var(--cl-action-primary)',
                    color: 'var(--cl-text-on-fill)', fontSize: 14, fontWeight: 700,
                    fontFamily: 'inherit',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading && loading !== plan.id ? 0.5 : 1,
                  }}
                >
                  {loading === plan.id ? 'Redirecting…' : `Choose ${plan.name}`}
                </button>

                <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 9, textAlign: 'left' }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.5, color: INK }}>
                      <Check size={15} style={{ color: 'var(--cl-success-text)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* Annual-only sweetener. Hidden on monthly so the offer is never
                    shown to someone who would not actually receive it. */}
                {plan.annualBonus && annual && (
                  <p style={{
                    margin: '16px 0 0', padding: '10px 12px', borderRadius: 10,
                    background: 'var(--cl-accent-soft)', textAlign: 'left',
                    fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: INK,
                  }}>
                    {plan.annualBonus}
                  </p>
                )}

                {plan.note && (
                  <p style={{
                    margin: '16px 0 0', paddingTop: 12, borderTop: '1px solid var(--cl-border-subtle)',
                    textAlign: 'left', fontSize: 12, lineHeight: 1.5, color: MUTED,
                  }}>
                    {plan.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p style={{ margin: '30px auto 0', maxWidth: 560, fontSize: 14, fontWeight: 600, color: INK }}>
          {PRICING_FOOTNOTE}
        </p>

        {/* Demo CTA */}
        <div style={{
          maxWidth: 560, margin: '18px auto 0', padding: '18px 22px', borderRadius: 16,
          background: 'var(--cl-bg-panel)', border: '1px solid var(--cl-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Not sure which plan?</div>
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{DEMO.note}</div>
          </div>
          <a
            href={DEMO.url}
            target={DEMO.url.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 20px',
              borderRadius: 999, background: 'var(--cl-bg-panel)', color: INK,
              border: '1px solid var(--cl-border)', fontWeight: 700, fontSize: 14,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            {DEMO.label}
          </a>
        </div>

        <div style={{ marginTop: 36 }}>
          <Link href="/" style={{ fontSize: 12, color: MUTED, textDecoration: 'none' }}>
            Powered by anglemotion.com
          </Link>
        </div>
      </div>
    </div>
  );
}

const PAGE_CSS = `
.pr-num { font-variant-numeric: tabular-nums; }
.pr-plans {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  align-items: start;
  text-align: left;
}
/* The featured card sits level with the others rather than scaled up — a
   transform would blur its text in a screenshot. */
@media (max-width: 900px) {
  .pr-plans { grid-template-columns: 1fr; max-width: 420px; margin: 0 auto; }
}
`;

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 18px',
    borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13, fontWeight: 700,
    background: active ? ACCENT : 'transparent',
    color: active ? 'var(--cl-text-on-fill)' : INK,
  };
}
