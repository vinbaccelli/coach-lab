'use client';

/**
 * Affiliates (admin) — create an affiliate, share their link and their private
 * page, edit their % / recurring / active, and settle their commissions.
 * Commissions are recorded by the Stripe webhook (lib/affiliates.server.ts);
 * paying them is done outside the app, then marked here. Admin-only (the API
 * enforces it). Docs: docs/AFFILIATES.md.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, X } from 'lucide-react';
import WorkspaceChrome from '@/components/WorkspaceChrome';
import { formatEur, influencerPagePath, PUBLIC_SITE, referralLink } from '@/lib/affiliates';
import type { AdminAffiliate } from '@/lib/affiliates.server';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function AdminAffiliatesPage() {
  const [list, setList] = useState<AdminAffiliate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', code: '', pct: '20', recurring: false });
  const [pcts, setPcts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/affiliates', { cache: 'no-store' });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setError(b.error ?? `Could not load affiliates (${res.status})`); return; }
    setError(null);
    setList(b.affiliates as AdminAffiliate[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (key: string, url: string, method: 'POST' | 'PATCH', body: unknown) => {
    setBusy(key); setError(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError(b.error ?? 'Failed'); return false; }
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }, [load]);

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setError('Could not copy — select the link and copy it by hand.');
    }
  }, []);

  const create = async () => {
    if (await send('create', '/api/admin/affiliates', 'POST', { ...form, pct: Number(form.pct) })) {
      setForm({ name: '', code: '', pct: form.pct, recurring: false });
    }
  };

  const linkRow = (key: string, label: string, url: string) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 92 }}>{label}</span>
      <code style={{ fontSize: 12, wordBreak: 'break-all', flex: '1 1 220px' }}>{url}</code>
      <button type="button" onClick={() => void copy(key, url)} style={secondaryBtn} aria-label={`Copy ${label}`}>
        {copied === key ? <Check size={14} /> : <Copy size={14} />} {copied === key ? 'Copied' : 'Copy'}
      </button>
    </div>
  );

  return (
    <WorkspaceChrome pageLabel="Affiliates">
      <div style={{ padding: '20px 16px 40px', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Affiliates</h1>
          <p style={muted}>
            Each affiliate shares their link. A coach who signs in after using it becomes their referral (the first link wins).
            A paid invoice of a referred coach earns a commission: the first payment only, or every payment when recurring is on.
            Amounts are after discounts and without tax. Pay affiliates outside the app, then mark the commission paid.
          </p>
        </div>

        <section style={card}>
          <h2 style={h2}>New affiliate</h2>
          <div style={controls}>
            <label style={label}>Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
            </label>
            <label style={label}>Code (link)
              <input value={form.code} placeholder="e.g. dani" onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} style={{ ...input, width: 140 }} />
            </label>
            <label style={label}>Commission %
              <input inputMode="decimal" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} style={{ ...input, width: 90 }} />
            </label>
            <label style={{ ...label, flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
              <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} /> Recurring
            </label>
            <button type="button" disabled={busy !== null || !form.name.trim() || !form.code.trim()} onClick={() => void create()} style={primaryBtn}>
              {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
            </button>
          </div>
          {form.code && <p style={muted}>Link: {PUBLIC_SITE}/r/{form.code}</p>}
        </section>

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{error}</p>}
        {!list && !error && <p style={muted}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2 }} /> Loading…</p>}

        {list && (
          <section style={card}>
            <h2 style={h2}>Overview</h2>
            {list.length === 0 ? <p style={muted}>No affiliates yet.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>{['Affiliate', 'Clicks', 'Signups', 'Buyers', 'Pending', 'Paid'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id}>
                        <td style={td}>{a.name}{!a.active && <span style={badge}>OFF</span>}</td>
                        <td style={tdNum}>{a.summary.clicks}</td>
                        <td style={tdNum}>{a.summary.signups}</td>
                        <td style={tdNum}>{a.summary.buyers}</td>
                        <td style={tdNum}>{formatEur(a.summary.pendingCents)}</td>
                        <td style={tdNum}>{formatEur(a.summary.paidCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {list?.map((a) => {
          const pct = pcts[a.id] ?? String(a.commission_pct);
          return (
            <section key={a.id} style={card}>
              <h2 style={{ ...h2, marginBottom: 2 }}>{a.name} {!a.active && <span style={badge}>INACTIVE</span>}</h2>
              <p style={{ ...muted, marginTop: 0 }}>{a.commission_pct}% · {a.recurring ? 'every payment' : 'first payment only'} · code {a.code}</p>
              {linkRow(`link:${a.id}`, 'Affiliate link', referralLink(a.code))}
              {linkRow(`page:${a.id}`, 'Private page', `${PUBLIC_SITE}${influencerPagePath(a.view_token)}`)}

              <div style={controls}>
                <label style={label}>Commission %
                  <input inputMode="decimal" value={pct} onChange={(e) => setPcts((p) => ({ ...p, [a.id]: e.target.value }))} style={{ ...input, width: 90 }} />
                </label>
                <button type="button" disabled={busy !== null || pct === String(a.commission_pct)} onClick={() => void send(a.id, `/api/admin/affiliates/${a.id}`, 'PATCH', { pct: Number(pct) })} style={secondaryBtn}>Save %</button>
                <label style={{ ...label, flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
                  <input type="checkbox" checked={a.recurring} disabled={busy !== null} onChange={(e) => void send(a.id, `/api/admin/affiliates/${a.id}`, 'PATCH', { recurring: e.target.checked })} /> Recurring
                </label>
                <label style={{ ...label, flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
                  <input type="checkbox" checked={a.active} disabled={busy !== null} onChange={(e) => void send(a.id, `/api/admin/affiliates/${a.id}`, 'PATCH', { active: e.target.checked })} /> Active
                </label>
              </div>

              <h3 style={{ ...h2, fontSize: 13, marginTop: 14 }}>Commissions ({a.commissions.length})</h3>
              {a.commissions.length === 0 && <p style={muted}>None yet.</p>}
              {a.commissions.map((c) => (
                <div key={c.id} style={row}>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    <strong>{formatEur(c.commission_cents)}</strong> · {c.pct}% of {formatEur(c.base_cents)} · {fmt(c.created_at)} ·{' '}
                    <span style={c.status === 'pending' ? badge : c.status === 'void' ? { ...badge, opacity: 0.6 } : { ...badge, borderColor: 'rgba(48,209,88,0.7)', color: 'rgb(48,209,88)' }}>
                      {c.status.toUpperCase()}
                    </span>
                    {c.paid_at && <span style={{ opacity: 0.8 }}> paid {fmt(c.paid_at)}</span>}
                  </p>
                  <p style={{ ...muted, fontSize: 11, wordBreak: 'break-all' }}>{c.stripe_invoice_id}{c.currency !== 'eur' ? ` · ${c.currency.toUpperCase()}` : ''}</p>
                  {c.status === 'pending' && (
                    <div style={controls}>
                      <button type="button" disabled={busy !== null} onClick={() => void send(c.id, `/api/admin/affiliates/commissions/${c.id}`, 'PATCH', { action: 'paid' })} style={primaryBtn}>
                        {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Mark paid
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void send(c.id, `/api/admin/affiliates/commissions/${c.id}`, 'PATCH', { action: 'void' })} style={secondaryBtn}>
                        <X size={14} /> Void
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </WorkspaceChrome>
  );
}

// Same plain styles as /admin/invoices.
const card: React.CSSProperties = { padding: 20, borderRadius: 14, background: 'rgba(15, 15, 18, 0.65)', border: '1px solid rgba(255,255,255,0.12)' };
const row: React.CSSProperties = { padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' };
const controls: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 };
const h2: React.CSSProperties = { margin: '0 0 8px', fontSize: 15, fontWeight: 800 };
const muted: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, opacity: 0.8 };
const badge: React.CSSProperties = { display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 6, fontSize: 11, fontWeight: 800, border: '1px solid rgba(255,159,10,0.7)', color: 'rgb(255,179,64)' };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 };
const input: React.CSSProperties = {
  minHeight: 40, borderRadius: 10, padding: '0 10px', fontSize: 14, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)', color: 'inherit', maxWidth: '100%', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 40, borderRadius: 10, border: 'none',
  background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 40, borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'var(--cl-text-on-fill)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, fontWeight: 700, opacity: 0.8, borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
