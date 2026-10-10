'use client';

/**
 * Past payments without an invoice record (D10). Lists paid Stripe sales
 * (one-off payment links and subscription invoices) since a date that have no
 * fiscal_invoices row. Nothing is created until Vin chooses, per payment:
 * "Add to invoicing" (to issue) or "Already invoiced elsewhere" (recorded as
 * external, never invoiced twice, and no longer listed).
 */

import React, { useCallback, useState } from 'react';
import { Loader2, Search, Plus, Check } from 'lucide-react';
import { formatPrice } from '@/lib/plans';

type Missing = {
  kind: 'checkout' | 'invoice'; id: string; paid_at: string; amount_cents: number; currency: string;
  customer: string | null; email: string | null; country: string | null; what: string | null; source: 'one_off' | 'subscription';
};

export default function MissingCard({ onChanged }: { onChanged: () => void }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [items, setItems] = useState<Missing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy('load'); setErr(null);
    try {
      const r = await fetch(`/api/admin/invoices/missing?from=${from}`, { cache: 'no-store' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(b.error ?? `Could not load (${r.status})`); return; }
      setItems(b.missing as Missing[]);
    } finally {
      setBusy(null);
    }
  }, [from]);

  const act = useCallback(async (m: Missing, action: 'add' | 'external') => {
    setBusy(m.id); setErr(null);
    try {
      const r = await fetch('/api/admin/invoices/missing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: m.kind, id: m.id, action }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(b.error ?? 'Failed'); return; }
      setItems((list) => list?.filter((x) => x.id !== m.id) ?? null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  return (
    <div>
      <p style={muted}>
        Paid sales from before this system (or missed) that have no invoice record. Nothing is created until you choose.
        If you already invoiced a payment by hand in FatturAE, mark it “Already invoiced elsewhere”.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
        <label style={label}>Paid since
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
        </label>
        <button type="button" onClick={() => void load()} disabled={busy !== null} style={secondaryBtn}>
          {busy === 'load' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find payments without an invoice
        </button>
      </div>
      {err && <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{err}</p>}
      {items && items.length === 0 && <p style={{ ...muted, marginTop: 10 }}>None — every paid sale since {from} has a record.</p>}
      {items?.map((m) => (
        <div key={m.id} style={row}>
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>{m.customer || m.email || '—'}</strong>{m.country ? ` · ${m.country}` : ''}
            {' · '}<strong>{m.currency === 'EUR' ? formatPrice(m.amount_cents / 100) : `${(m.amount_cents / 100).toFixed(2)} ${m.currency}`}</strong>
            {' · '}{m.source === 'one_off' ? 'One-off' : 'Subscription'}{m.what ? ` · ${m.what}` : ''}
          </p>
          <p style={muted}>Paid {new Date(m.paid_at).toLocaleDateString('it-IT')} · {m.id}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" disabled={busy !== null} onClick={() => void act(m, 'add')} style={primaryBtn}>
              {busy === m.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to invoicing
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void act(m, 'external')} style={secondaryBtn}>
              <Check size={14} /> Already invoiced elsewhere
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const muted: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, opacity: 0.8 };
const row: React.CSSProperties = { padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 10 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 };
const input: React.CSSProperties = {
  minHeight: 40, borderRadius: 10, padding: '0 10px', fontSize: 14, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)', color: 'inherit',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 40, borderRadius: 10, border: 'none',
  background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 40, borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'var(--cl-text-on-fill)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
