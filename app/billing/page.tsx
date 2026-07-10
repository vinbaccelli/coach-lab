'use client';

/**
 * Account & billing — subscription status, Stripe billing portal, sign out.
 * Status comes from the subscriptions table (written by the Stripe webhook).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, LogOut, Loader2, ExternalLink } from 'lucide-react';
import WorkspaceChrome from '@/components/WorkspaceChrome';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

type SubStatus = { status: string; email: string | null; updatedAt?: string | null; tier?: string | null; seats?: number | null };

const TIER_LABEL: Record<string, string> = { light: 'Light', pro: 'Pro', academy: 'Academy' };

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export default function BillingPage() {
  const router = useRouter();
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stripe/subscription')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: SubStatus | null) => setSub(body))
      .catch(() => setSub(null))
      .finally(() => setLoading(false));
  }, []);

  const openPortal = useCallback(async () => {
    setPortalLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error === 'No subscription found'
          ? 'No Stripe subscription found for this account yet — subscribe first.'
          : body.error ?? 'Could not open the billing portal.');
        return;
      }
      window.location.href = body.url;
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    router.push('/login');
  }, [router]);

  const isActive = !!sub && ACTIVE_STATUSES.has(sub.status);

  return (
    <WorkspaceChrome pageLabel="Account & Billing">
      <div style={{ padding: '20px 16px 40px', maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>Account</h2>
          {loading ? (
            <p style={muted}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2 }} /> Loading…</p>
          ) : (
            <p style={muted}>{sub?.email ?? 'Not signed in'}</p>
          )}
          <button type="button" onClick={() => void signOut()} style={{ ...secondaryBtn, marginTop: 10 }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>

        <div style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>Subscription</h2>
          {loading ? (
            <p style={muted}>Checking subscription…</p>
          ) : isActive ? (
            <p style={muted}>
              Plan: <strong>{sub?.tier ? TIER_LABEL[sub.tier] ?? sub.tier : 'Pro'}</strong>
              {sub?.seats && sub.seats > 1 ? ` · ${sub.seats} seats` : ''}
              {' · '}Status: <strong style={{ color: '#30D158' }}>{sub!.status}</strong>
              {sub?.updatedAt ? ` · updated ${new Date(sub.updatedAt).toLocaleDateString()}` : ''}
            </p>
          ) : (
            <p style={muted}>
              Status: <strong>{sub?.status && sub.status !== 'none' ? sub.status : 'no active subscription'}</strong>
              {' — '}plans from $5/mo (Light) to $40/mo (Academy) via Stripe.
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            {!isActive && (
              <Link href="/pricing" style={{ ...primaryBtn, textDecoration: 'none' }}>
                <CreditCard size={14} /> View plans & subscribe
              </Link>
            )}
            <button type="button" onClick={() => void openPortal()} disabled={portalLoading} style={isActive ? primaryBtn : secondaryBtn}>
              {portalLoading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              Manage billing (Stripe portal)
            </button>
          </div>
          {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#FF453A', fontWeight: 600 }}>{error}</p>}
          <p style={{ ...muted, marginTop: 12, fontSize: 11 }}>
            Invoices, payment method, plan changes, and cancellation are handled in the Stripe customer portal.
          </p>
        </div>
      </div>
    </WorkspaceChrome>
  );
}

const card: React.CSSProperties = {
  padding: 20,
  borderRadius: 14,
  background: 'rgba(15, 15, 18, 0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
};

const muted: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.75 };

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff',
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
