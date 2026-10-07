'use client';

/**
 * Account & billing — subscription status, Stripe billing portal, sign out.
 * Status comes from the subscriptions table (written by the Stripe webhook).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, LogOut, Loader2, ExternalLink, Download, UserPlus, X } from 'lucide-react';
import WorkspaceChrome from '@/components/WorkspaceChrome';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useEntitlement } from '@/lib/useEntitlement';
import { EBOOK_TITLE, PLANS, PRICE_TAX_NOTE, SUPPORT_EMAIL, formatPrice } from '@/lib/plans';

type SubStatus = {
  status: string; email: string | null; updatedAt?: string | null; tier?: string | null; seats?: number | null;
  billingInterval?: string | null; currentPeriodEnd?: string | null; cancelAtPeriodEnd?: boolean;
  /** Policy outcome from lib/entitlements.ts, computed server-side. */
  plan?: string | null; paymentFailed?: boolean; endsAt?: string | null;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const TIER_LABEL: Record<string, string> = { light: 'Light', pro: 'Pro', academy: 'Academy' };

export default function BillingPage() {
  const router = useRouter();
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ent } = useEntitlement();

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

  // Access follows the server-side policy: active, trialing and past_due all
  // still grant the plan (lib/entitlements.ts).
  const isActive = !!sub?.plan;

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
              Plan: <strong>{sub?.tier ? TIER_LABEL[sub.tier] ?? sub.tier : '—'}</strong>
              {sub?.seats && sub.seats > 1 ? ` · up to ${sub.seats} coaches` : ''}
              {' · '}Status: <strong style={{ color: sub?.paymentFailed ? '#FF6961' : '#30D158' }}>{sub?.paymentFailed ? 'payment failed' : sub!.status}</strong>
              {sub?.billingInterval ? ` · billed ${sub.billingInterval === 'year' ? 'yearly' : 'monthly'}` : ''}
              {sub?.currentPeriodEnd && !sub.endsAt ? ` · renews ${fmtDate(sub.currentPeriodEnd)}` : ''}
            </p>
          ) : ent?.academyMember ? (
            <p style={muted} data-academy-member>
              You’re a coach on an <strong>Academy</strong> plan: every Pro tool is included while the plan is active.
              Billing is handled by the Academy owner.
            </p>
          ) : (
            <p style={muted}>
              Status: <strong>{sub?.status && sub.status !== 'none' ? sub.status : 'no active subscription'}</strong>
              {' — '}plans from {formatPrice(PLANS[0].priceMonthly)}/mo ({PLANS[0].name}) to{' '}
              {formatPrice(PLANS[PLANS.length - 1].priceMonthly)}/mo ({PLANS[PLANS.length - 1].name}) via Stripe.
              {' '}{PRICE_TAX_NOTE}
            </p>
          )}
          {sub?.paymentFailed && (
            <p role="alert" style={{ ...notice, borderColor: 'rgba(255,69,58,0.55)' }}>
              <strong>Payment failed.</strong> Stripe is retrying your card and your plan stays active meanwhile —
              update your card in the billing portal below to keep it.
            </p>
          )}
          {sub?.endsAt && (
            <p style={notice}>
              Your plan is cancelled and <strong>ends on {fmtDate(sub.endsAt)}</strong>. Everything stays available
              until then, and your saved work is kept afterwards. Resubscribe any time from the billing portal.
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            {!isActive && !ent?.academyMember && (
              <Link href="/pricing" style={{ ...primaryBtn, textDecoration: 'none' }}>
                <CreditCard size={14} /> View plans & subscribe
              </Link>
            )}
            {/* A seat member has no Stripe customer of their own: nothing to manage. */}
            {(isActive || !ent?.academyMember) && (
              <button type="button" onClick={() => void openPortal()} disabled={portalLoading} style={isActive ? primaryBtn : secondaryBtn}>
                {portalLoading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                Manage billing (Stripe portal)
              </button>
            )}
          </div>
          {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{error}</p>}
          <p style={{ ...muted, marginTop: 12, fontSize: 11 }}>
            Invoices, payment method, plan changes, and cancellation are handled in the Stripe customer portal.
          </p>
        </div>

        <EbookCard />
        <AcademySeatsCard />
      </div>
    </WorkspaceChrome>
  );
}

/**
 * Spin Mechanics download — shown only to coaches the server says are eligible
 * (yearly Pro / Academy). The link is minted on click (short-lived signed URL
 * from the private "ebooks" bucket); if the file isn't there, "contact us".
 */
function EbookCard() {
  const [state, setState] = useState<{ eligible: boolean; available: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch('/api/ebook', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { eligible?: boolean; available?: boolean } | null) =>
        setState(b ? { eligible: !!b.eligible, available: !!b.available } : null))
      .catch(() => setState(null));
  }, []);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/ebook', { method: 'POST' });
      const b = (await res.json().catch(() => ({}))) as { url?: string };
      if (res.ok && b.url) window.location.href = b.url;
      else setMissing(true);
    } catch {
      setMissing(true);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!state?.eligible) return null;
  const unavailable = !state.available || missing;
  return (
    <div style={card} data-ebook-card>
      <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>{EBOOK_TITLE} ebook</h2>
      <p style={muted}>Included with your yearly plan.</p>
      {unavailable ? (
        <p style={notice} data-ebook-unavailable>
          The download isn’t ready right now. Write to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${EBOOK_TITLE} ebook`)}`} style={{ color: 'inherit', fontWeight: 700 }}>
            {SUPPORT_EMAIL}
          </a>{' '}and we’ll send it to you.
        </p>
      ) : (
        <button type="button" onClick={() => void download()} disabled={busy} style={{ ...primaryBtn, marginTop: 10 }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
        </button>
      )}
    </div>
  );
}

type Seats = { canManage: boolean; seats: number; members: Array<{ email: string; created_at: string }> };

/**
 * "Coaches on your plan" — the Academy owner adds up to 3 coaches by the email
 * they sign in with. Each coach keeps their own players and reports; the seat
 * only lends them the plan. Shown to Academy owners, and to former owners who
 * still have seats listed (so they can remove them).
 */
function AcademySeatsCard() {
  const [data, setData] = useState<Seats | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/academy-members', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Seats | null) => setData(b))
      .catch(() => setData(null));
  }, []);

  const call = useCallback(async (init: RequestInit, url = '/api/academy-members') => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(url, init);
      const b = (await res.json().catch(() => ({}))) as { members?: Seats['members']; error?: string; message?: string };
      if (!res.ok) { setErr(b.message ?? b.error ?? 'Something went wrong.'); return false; }
      if (b.members) setData((d) => (d ? { ...d, members: b.members! } : d));
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  if (!data || (!data.canManage && data.members.length === 0)) return null;
  const full = data.members.length >= data.seats;
  return (
    <div style={card} data-academy-seats>
      <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>Coaches on your plan</h2>
      <p style={muted}>
        Academy covers you plus {data.seats} coaches. Add the email each coach signs in with: they get every Pro tool,
        and their players and reports stay their own.
      </p>
      {!data.canManage && (
        <p style={notice}>Your Academy plan isn’t active, so these coaches don’t have the plan right now.</p>
      )}
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.members.map((m) => (
          <li key={m.email} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</span>
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove ${m.email}`}
              onClick={() => void call({ method: 'DELETE' }, `/api/academy-members?email=${encodeURIComponent(m.email)}`)}
              style={{ ...secondaryBtn, padding: '8px 10px', minHeight: 36 }}
            >
              <X size={14} /> Remove
            </button>
          </li>
        ))}
        {data.members.length === 0 && <li style={muted}>No coaches added yet.</li>}
      </ul>
      {data.canManage && !full && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
            if (ok) setEmail('');
          }}
          style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="coach@example.com"
            aria-label="Coach email"
            style={{
              flex: '1 1 200px', minWidth: 0, minHeight: 40, borderRadius: 10, padding: '0 12px', fontSize: 14,
              border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: 'inherit',
            }}
          />
          <button type="submit" disabled={busy || !email.trim()} style={primaryBtn}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Add coach
          </button>
        </form>
      )}
      {data.canManage && full && <p style={{ ...muted, marginTop: 10 }}>All {data.seats} seats are in use. Remove a coach to add another.</p>}
      {err && <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{err}</p>}
    </div>
  );
}

const card: React.CSSProperties = {
  padding: 20,
  borderRadius: 14,
  background: 'rgba(15, 15, 18, 0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
};

const muted: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.75 };

const notice: React.CSSProperties = {
  margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
  border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)',
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
  color: 'var(--cl-text-on-fill)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
