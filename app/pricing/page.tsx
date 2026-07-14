'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { PLANS, DEMO, planPrice, yearlyPerMonth, type PlanId, type BillingCycle } from '@/lib/plans';

const INK = '#1D1D1F';
const MUTED = '#6E6E73';
const ACCENT = '#007AFF';

export default function PricingPage() {
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

  return (
    // Own scroll container — globals.css locks body overflow for the canvas app.
    <div style={{ height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#F5F5F7', color: INK, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #E5E5EA',
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/logo-square-new.jpg" alt="AngleMotion" style={{ width: 28, height: 28, borderRadius: 6 }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: INK }}>AngleMotion</span>
        </Link>
        <Link href="/login" style={{
          fontSize: 12, fontWeight: 600, color: INK, textDecoration: 'none',
          padding: '6px 14px', borderRadius: 20, border: '1px solid #D1D1D6',
        }}>
          Sign In
        </Link>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 20px 80px', textAlign: 'center' }}>
        {subscriptionRequired && (
          <div style={{
            margin: '0 auto 28px', maxWidth: 560, padding: '12px 18px',
            borderRadius: 12, background: 'rgba(255,159,10,0.12)',
            border: '1px solid rgba(255,159,10,0.45)',
            fontSize: 13, fontWeight: 600, color: '#B25E00',
          }}>
            Video Analysis requires an active plan — pick one below to unlock it.
          </div>
        )}
        <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(30px,5vw,42px)', fontWeight: 900, letterSpacing: -1 }}>
          Simple pricing for coaches.
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: 16, color: MUTED }}>
          Start light, or go Pro for the full platform + Academy. Less than one lesson a month.
        </p>

        {/* Billing toggle */}
        <div style={{ display: 'inline-flex', background: '#EDEDED', borderRadius: 999, padding: 4, marginBottom: 36 }}>
          <button type="button" onClick={() => setCycle('yearly')} style={toggleBtn(cycle === 'yearly')}>
            Yearly <span style={{ fontSize: 10, fontWeight: 800, color: cycle === 'yearly' ? '#fff' : ACCENT }}>· 2 mo free</span>
          </button>
          <button type="button" onClick={() => setCycle('monthly')} style={toggleBtn(cycle === 'monthly')}>Monthly</button>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 40, alignItems: 'stretch' }}>
          {PLANS.map((plan) => {
            const price = planPrice(plan, cycle);
            return (
              <div key={plan.id} style={{
                flex: '1 1 300px', maxWidth: 360, textAlign: 'left',
                background: '#fff',
                border: plan.featured ? `2px solid ${ACCENT}` : '1px solid #E5E5EA',
                borderRadius: 18, padding: 26,
                boxShadow: plan.featured ? '0 14px 44px rgba(0,122,255,0.14)' : '0 1px 3px rgba(0,0,0,0.04)',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>{plan.name}</span>
                  {plan.featured && <span style={{ fontSize: 10, fontWeight: 800, background: ACCENT, color: '#fff', padding: '2px 8px', borderRadius: 999 }}>MOST POPULAR</span>}
                  {plan.seats > 1 && <span style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>up to {plan.seats} coaches</span>}
                </div>
                <p style={{ fontSize: 13, color: MUTED, margin: '0 0 14px' }}>{plan.tagline}</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1 }}>${price}</span>
                  <span style={{ fontSize: 15, color: MUTED }}>{cycle === 'yearly' ? '/yr' : '/mo'}</span>
                </div>
                <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 16px', minHeight: 16 }}>
                  {cycle === 'yearly' ? `$${yearlyPerMonth(plan)}/mo · 2 months free` : 'Billed monthly · cancel anytime'}
                </p>
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={() => handleCheckout(plan.id)}
                  style={{
                    width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
                    background: plan.featured ? ACCENT : '#1D1D1F', color: '#fff', fontSize: 15, fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== plan.id ? 0.5 : 1,
                  }}
                >
                  {loading === plan.id ? 'Redirecting…' : `Choose ${plan.name}`}
                </button>
                <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: INK }}>
                      <Check size={16} style={{ color: '#30A46C', flexShrink: 0, marginTop: 1 }} /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Demo CTA */}
        <div style={{
          maxWidth: 560, margin: '0 auto', padding: '20px 24px', borderRadius: 16,
          background: '#fff', border: '1px solid #E5E5EA',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Not sure which plan?</div>
            <div style={{ fontSize: 13, color: MUTED }}>{DEMO.note}</div>
          </div>
          <a href={DEMO.url} target={DEMO.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{
            padding: '11px 20px', borderRadius: 999, background: 'transparent', color: ACCENT,
            border: `1.5px solid ${ACCENT}`, fontWeight: 700, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            {DEMO.label}
          </a>
        </div>

        <div style={{ marginTop: 40 }}>
          <Link href="/" style={{ fontSize: 12, color: '#B0B0B5', textDecoration: 'none' }}>
            Powered by anglemotion.com
          </Link>
        </div>
      </div>
    </div>
  );
}

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: '8px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 700, background: active ? ACCENT : 'transparent', color: active ? '#fff' : INK,
  };
}
