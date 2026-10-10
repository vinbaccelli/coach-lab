'use client';

/**
 * Invoices (admin) — turn paid Stripe sales (subscriptions AND one-off
 * payment-link sales) into Italian fatture elettroniche. Every paid sale
 * arrives here as "To issue" (written by the Stripe webhook). Also: the
 * Invoice settings form (D9) and the review of past payments without an
 * invoice record (D10). Vin checks the number (it continues his FatturAE sequence),
 * issues it, downloads the FatturaPA XML and uploads it in the Agenzia delle
 * Entrate portal "Fatture e Corrispettivi", then marks it sent.
 * Workflow and settings: docs/INVOICING.md. Admin-only (API enforces it).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Loader2, Check, Undo2, AlertTriangle } from 'lucide-react';
import WorkspaceChrome from '@/components/WorkspaceChrome';
import { formatPrice } from '@/lib/plans';
import SettingsCard from './SettingsCard';
import MissingCard from './MissingCard';

type Invoice = {
  id: string; status: 'to_issue' | 'issued' | 'sent' | 'external'; paid_at: string; amount_cents: number; currency: string;
  plan: string | null; billing_interval: string | null; customer_name: string | null; business_name: string | null;
  customer_email: string | null; customer_country: string | null; is_business: boolean;
  invoice_number: number | null; invoice_year: number | null; invoice_date: string | null;
  stamp_duty_amount: number | null; xml_file_name: string | null; problems: string[];
  source: 'subscription' | 'one_off'; product_description: string | null; customer_category: string | null;
  taxable_amount_cents: number | null; vat_amount_cents: number | null; stamp_duty_cents: number | null;
  invoice_total_cents: number | null; tax_nature: string | null; note: string | null;
};
type ListResponse = {
  invoices: Invoice[]; suggestedNumber: number; today: string; settingsProblems: string[]; year: number; euB2cThisYearCents: number;
};

const ISSUE_WITHIN_DAYS = 12;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function AdminInvoicesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/invoices', { cache: 'no-store' });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setError(b.error ?? `Could not load invoices (${res.status})`); return; }
    setError(null);
    setData(b as ListResponse);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (id: string, url: string, body: unknown) => {
    setBusy(id); setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError([b.error, ...(b.problems ?? [])].filter(Boolean).join(' — ') || 'Failed'); return; }
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  const toIssue = data?.invoices.filter((i) => i.status === 'to_issue') ?? [];
  const done = data?.invoices.filter((i) => i.status === 'issued' || i.status === 'sent') ?? [];
  const external = data?.invoices.filter((i) => i.status === 'external') ?? [];
  const [showSettings, setShowSettings] = useState(false);
  // The oldest unissued invoice gets the next number first.
  const ordered = [...toIssue].sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  const issuable = ordered.filter((i) => i.problems.length === 0).map((i) => i.id);

  return (
    <WorkspaceChrome pageLabel="Invoices">
      <div style={{ padding: '20px 16px 40px', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Fatture elettroniche</h1>
          <p style={muted}>
            Each paid subscription appears here. Issue it, download the XML and upload it in Fatture e Corrispettivi
            (Agenzia delle Entrate), then mark it sent. Issue within {ISSUE_WITHIN_DAYS} days of the payment.
          </p>
          <a href="/api/admin/invoices?format=csv" style={{ ...secondaryBtn, marginTop: 10, textDecoration: 'none' }}>
            <Download size={14} /> Export CSV for the accountant
          </a>
        </div>

        {data && data.settingsProblems.length > 0 && !showSettings && (
          <div role="alert" style={{ ...card, borderColor: 'rgba(255,159,10,0.6)' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Invoice settings incomplete — nothing can be issued yet</p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {data.settingsProblems.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <button type="button" onClick={() => setShowSettings(true)} style={{ ...primaryBtn, marginTop: 10 }}>Open Invoice settings</button>
          </div>
        )}

        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ ...h2, margin: 0 }}>Invoice settings</h2>
            <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} style={secondaryBtn}>
              {showSettings ? 'Close' : 'Edit'}
            </button>
          </div>
          {showSettings
            ? <SettingsCard onSaved={() => void load()} />
            : <p style={muted}>Your fiscal data, the forfettario wording, VAT treatment per customer, stamp duty and numbering.</p>}
        </section>

        {data && data.euB2cThisYearCents > 0 && (
          <p role="status" style={{ ...card, margin: 0, fontSize: 13 }}>
            EU private customers in {data.year}: <strong>{formatPrice(data.euB2cThisYearCents / 100)}</strong> so far.
            Their VAT treatment (OSS) is pending your accountant.
          </p>
        )}

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{error}</p>}
        {!data && !error && <p style={muted}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2 }} /> Loading…</p>}

        {data && (
          <section style={card}>
            <h2 style={h2}>To issue ({toIssue.length})</h2>
            {ordered.length === 0 && <p style={muted}>Nothing to issue.</p>}
            {ordered.map((inv) => {
              const due = new Date(new Date(inv.paid_at).getTime() + ISSUE_WITHIN_DAYS * 86400000);
              const overdue = due.getTime() < Date.now();
              // Numbers are proposed only to invoices that can be issued now, in
              // payment order, so a blocked one never leaves a gap.
              const slot = issuable.indexOf(inv.id);
              const number = numbers[inv.id] ?? (slot >= 0 ? String(data.suggestedNumber + slot) : '');
              const date = dates[inv.id] ?? data.today;
              const blocked = inv.problems.length > 0 || data.settingsProblems.length > 0;
              return (
                <div key={inv.id} style={row}>
                  <Summary inv={inv} />
                  <p style={{ ...muted, color: overdue ? 'var(--cl-destructive-text)' : undefined }}>
                    Paid {fmt(inv.paid_at)} · issue by {fmt(due.toISOString())}{overdue ? ' (late)' : ''}
                  </p>
                  {inv.problems.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                      {inv.problems.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
                    <label style={label}>Number
                      <input inputMode="numeric" value={number} onChange={(e) => setNumbers((n) => ({ ...n, [inv.id]: e.target.value }))} style={{ ...input, width: 90 }} />
                    </label>
                    <label style={label}>Date
                      <input type="date" value={date} onChange={(e) => setDates((d) => ({ ...d, [inv.id]: e.target.value }))} style={input} />
                    </label>
                    <button
                      type="button"
                      disabled={blocked || busy !== null || !number}
                      onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/issue`, { number: Number(number), date })}
                      style={primaryBtn}
                    >
                      {busy === inv.id ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {number ? `Issue n. ${number}` : 'Issue'}
                    </button>
                  </div>
                </div>
              );
            })}
            {ordered.length > 1 && (
              <p style={{ ...muted, marginTop: 8 }}>Numbers are proposed in payment order. Issue them in that order, or change them.</p>
            )}
          </section>
        )}

        {data && (
          <section style={card}>
            <h2 style={h2}>Past payments without an invoice</h2>
            <MissingCard onChanged={() => void load()} />
            {external.length > 0 && (
              <p style={{ ...muted, marginTop: 10 }}>{external.length} past payment{external.length === 1 ? '' : 's'} marked as already invoiced elsewhere.</p>
            )}
          </section>
        )}

        {data && (
          <section style={card}>
            <h2 style={h2}>Issued ({done.length})</h2>
            {done.length === 0 && <p style={muted}>None yet.</p>}
            {done.map((inv) => (
              <div key={inv.id} style={row}>
                <Summary inv={inv} />
                <p style={muted}>
                  <strong>n. {inv.invoice_number}/{inv.invoice_year}</strong> del {inv.invoice_date ? fmt(inv.invoice_date) : '—'}
                  {inv.tax_nature ? ` · ${inv.tax_nature}` : ''}
                  {inv.invoice_total_cents !== null
                    ? ` · price ${formatPrice((inv.taxable_amount_cents ?? 0) / 100)}, VAT ${formatPrice((inv.vat_amount_cents ?? 0) / 100)}, stamp duty ${formatPrice((inv.stamp_duty_cents ?? 0) / 100)} (absorbed), total ${formatPrice(inv.invoice_total_cents / 100)}`
                    : ''}
                  {' · '}{inv.status === 'sent' ? 'sent to SdI' : 'XML ready — upload it, then mark sent'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <a href={`/api/admin/invoices/${inv.id}/xml`} style={{ ...secondaryBtn, textDecoration: 'none' }}>
                    <Download size={14} /> {inv.xml_file_name ?? 'XML'}
                  </a>
                  {inv.status === 'issued' && (
                    <>
                      <button type="button" disabled={busy !== null} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'sent' })} style={primaryBtn}>
                        <Check size={14} /> Mark sent
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'unissue' })} style={secondaryBtn}>
                        <Undo2 size={14} /> Undo (not uploaded yet)
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </WorkspaceChrome>
  );
}

function Summary({ inv }: { inv: Invoice }) {
  const who = inv.business_name || inv.customer_name || inv.customer_email || '—';
  const plan = inv.source === 'one_off'
    ? `One-off${inv.product_description ? `: ${inv.product_description}` : ''}`
    : inv.plan ? `Subscription: ${inv.plan.charAt(0).toUpperCase()}${inv.plan.slice(1)} ${inv.billing_interval === 'year' ? 'yearly' : inv.billing_interval === 'month' ? 'monthly' : ''}` : 'Subscription';
  const category = inv.customer_category ? ` · ${inv.customer_category.replace('_', ' ').replace('NON EU', 'non-EU')}` : '';
  return (
    <p style={{ margin: 0, fontSize: 14 }}>
      <strong>{who}</strong>{inv.customer_country ? ` · ${inv.customer_country}` : ''}{category}
      {' · '}<strong>{inv.currency === 'EUR' ? formatPrice(inv.amount_cents / 100) : `${(inv.amount_cents / 100).toFixed(2)} ${inv.currency}`}</strong>
      {plan ? ` · ${plan}` : ''}
    </p>
  );
}

const card: React.CSSProperties = { padding: 20, borderRadius: 14, background: 'rgba(15, 15, 18, 0.65)', border: '1px solid rgba(255,255,255,0.12)' };
const row: React.CSSProperties = { padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' };
const h2: React.CSSProperties = { margin: '0 0 8px', fontSize: 15, fontWeight: 800 };
const muted: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, opacity: 0.8 };
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
