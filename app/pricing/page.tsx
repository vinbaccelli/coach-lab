'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

const features = [
  'Video Analysis with all drawing tools',
  'Skeleton AI pose detection',
  'StroMotion composites',
  'AI Detect Angles (13+ measurements)',
  'Data Column with per-frame persistence',
  'Screenshot save to player docs',
  'Manual Match Report → Google Docs',
  'AI Match Decoder (SwingVision)',
  'CoachLab Academy (PDFs + guides)',
  'Coach public profile page',
  'Player database with folders',
  'Recording Hub (screen + webcam + mic)',
  'Unlimited video uploads',
];

export default function PricingPage() {
  const [loading, setLoading] = useState<'monthly' | 'yearly' | null>(null);

  const handleCheckout = async (plan: 'monthly' | 'yearly') => {
    setLoading(plan);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
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
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #0a0a10 0%, #0f1420 100%)',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/logo-square.svg" alt="CoachLab" style={{ width: 28, height: 28, borderRadius: 6 }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>
            Coach<span style={{ color: '#FF3B30' }}>Lab</span>.ai
          </span>
        </Link>
        <Link href="/login" style={{
          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
          padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)',
        }}>
          Sign In
        </Link>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '60px 20px 80px', textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 36, fontWeight: 900, letterSpacing: -0.5 }}>
          CoachLab Pro
        </h1>
        <p style={{ margin: '0 0 40px', fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>
          The complete video analysis platform for tennis coaches
        </p>

        {/* Pricing cards */}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
          {/* Monthly */}
          <div style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 20, padding: '32px 28px', width: 280, textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Monthly</div>
            <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 4 }}>
              $20<span style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>Cancel anytime</div>
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => handleCheckout('monthly')}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: '#007AFF', color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading === 'yearly' ? 0.5 : 1,
              }}
            >
              {loading === 'monthly' ? 'Redirecting…' : 'Start Monthly'}
            </button>
          </div>

          {/* Yearly */}
          <div style={{
            background: 'rgba(255,255,255,0.08)', border: '2px solid #007AFF',
            borderRadius: 20, padding: '32px 28px', width: 280, textAlign: 'center',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
              background: '#007AFF', color: '#fff', fontSize: 11, fontWeight: 700,
              padding: '4px 14px', borderRadius: 20,
            }}>
              SAVE 17%
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Yearly</div>
            <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 4 }}>
              $200<span style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>/yr</span>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>~$16.67/month</div>
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => handleCheckout('yearly')}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: '#007AFF', color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading === 'monthly' ? 0.5 : 1,
              }}
            >
              {loading === 'yearly' ? 'Redirecting…' : 'Start Yearly — Best Value'}
            </button>
          </div>
        </div>

        {/* Features */}
        <div style={{ textAlign: 'left', maxWidth: 400, margin: '0 auto' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
            Everything included
          </h3>
          {features.map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              <Check size={16} style={{ color: '#34C759', flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 40 }}>
          <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Powered by CoachLab.academy
          </Link>
        </div>
      </div>
    </div>
  );
}
