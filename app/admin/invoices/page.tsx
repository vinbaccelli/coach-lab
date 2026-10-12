'use client';

/**
 * Invoices (admin) — turn paid Stripe sales (Anglemotion subscriptions AND
 * one-off sales: coaching, video analysis, ebooks, payment links) into Italian
 * fatture elettroniche. The Stripe webhook records every paid sale as
 * "To issue" (test-mode ones flagged TEST, never issuable). Also here: the
 * Invoice settings (D9), the review queue for historical payments (D10),
 * webhook errors, and a preview + checklist for every invoice before issuing.
 *
 * Issuing stores the FatturaPA XML; it does NOT transmit it. Vin uploads the
 * XML in "Fatture e Corrispettivi" (Agenzia delle Entrate), then marks it sent.
 * Workflow and settings: docs/INVOICING.md. Admin-only (the API enforces it).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Loader2, Check, Undo2, AlertTriangle, Eye, X, RotateCcw } from 'lucide-react';
import WorkspaceChrome from '@/components/WorkspaceChrome';
import { formatPrice } from '@/lib/plans';
import SettingsCard from './SettingsCard';
import MissingCard from './MissingCard';

type Status = 'to_issue' | 'review' | 'issued' | 'sent' | 'external' | 'void';
type Invoice = {
  id: string; status: Status; paid_at: string; amount_cents: number; currency: string; livemode: boolean;
  plan: string | null; billing_interval: string | null; customer_name: string | null; business_name: string | null;
  customer_email: string | null; customer_country: string | null; is_business: boolean;
  invoice_number: number | null; invoice_year: number | null; invoice_date: string | null;
  stamp_duty_amount: number | null; xml_file_name: string | null; problems: string[];
  source: 'subscription' | 'one_off'; product_description: string | null; customer_category: string | null;
  product_type: string | null;
  taxable_amount_cents: number | null; vat_amount_cents: number | null; stamp_duty_cents: number | null;
  invoice_total_cents: number | null; tax_nature: string | null; note: string | null;
  refunded_amount_cents: number | null; sdi_id: string | null; external_reference: string | null; void_reason: string | null;
  stripe_invoice_id: string | null; stripe_checkout_session_id: string | null;
};
type WebhookError = { event_id: string; event_type: string; livemode: boolean | null; error: string; attempts: number; last_failed_at: string };
type ListResponse = {
  invoices: Invoice[]; suggestedNumber: number; today: string; settingsProblems: string[]; year: number;
  euB2cThisYearCents: number; webhookErrors: WebhookError[];
};
type Preview = {
  number: number; date: string; problems: string[]; checks: Array<{ label: string; ok: boolean; detail?: string }>;
  xml: string | null; fileName: string | null; gapFrom: number | null;
};

const PRODUCT_TYPES: Array<[string, string]> = [
  ['coaching_service', 'Coaching / video analysis'],
  ['digital_product', 'Ebook / digital product'],
  ['other', 'Other one-off sale'],
];
const ISSUE_WITHIN_DAYS = 12;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const money = (cents: number, currency = 'EUR') => (currency === 'EUR' ? formatPrice(cents / 100) : `${(cents / 100).toFixed(2)} ${currency}`);

export default function AdminInvoicesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [gapOk, setGapOk] = useState<Record<string, boolean>>({});
  const [gapAsk, setGapAsk] = useState<Record<string, number>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/invoices', { cache: 'no-store' });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setError(b.error ?? `Could not load invoices (${res.status})`); return; }
    setError(null);
    setData(b as ListResponse);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = useCallback(async (id: string, url: string, body: unknown): Promise<Record<string, unknown> | null> => {
    setBusy(id); setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof b.gapFrom === 'number') setGapAsk((g) => ({ ...g, [id]: b.gapFrom }));
        setError([b.error, ...((b.problems as string[]) ?? [])].filter(Boolean).join(' — ') || 'Failed');
        return null;
      }
      return b;
    } finally {
      setBusy(null);
    }
  }, []);
  const act = useCallback(async (id: string, url: string, body: unknown) => {
    if (await post(id, url, body)) {
      setPreviews((p) => { const n = { ...p }; delete n[id]; return n; });
      await load();
    }
  }, [post, load]);
  const preview = useCallback(async (id: string, number: string, date: string) => {
    const b = await post(id, `/api/admin/invoices/${id}/preview`, { number: Number(number) || undefined, date, confirmGap: !!gapOk[id] });
    if (b) setPreviews((p) => ({ ...p, [id]: b as unknown as Preview }));
  }, [post, gapOk]);

  const all = data?.invoices ?? [];
  const live = all.filter((i) => i.livemode !== false);
  const toIssue = live.filter((i) => i.status === 'to_issue').sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  const review = live.filter((i) => i.status === 'review').sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  const tests = all.filter((i) => i.livemode === false && (i.status === 'to_issue' || i.status === 'review'));
  const done = all.filter((i) => i.status === 'issued' || i.status === 'sent');
  const closed = all.filter((i) => i.status === 'external' || i.status === 'void');
  // Numbers are proposed only to invoices that can be issued now, in payment
  // order, so a blocked one never leaves a gap.
  const issuable = toIssue.filter((i) => i.problems.length === 0).map((i) => i.id);
  const text = (k: string) => texts[k] ?? '';
  const setText = (k: string, v: string) => setTexts((t) => ({ ...t, [k]: v }));

  const productPicker = (inv: Invoice) => inv.source === 'one_off' && (
    <label style={label}>Product type
      <select
        value={inv.product_type ?? ''}
        disabled={busy !== null}
        onChange={(e) => e.target.value && void act(inv.id, `/api/admin/invoices/${inv.id}/product-type`, { productType: e.target.value })}
        style={input}
      >
        <option value="">— choose —</option>
        {PRODUCT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const voidControls = (inv: Invoice) => (
    <>
      <input aria-label="Reason for voiding" placeholder="Reason (e.g. refunded, test)" value={text(`void:${inv.id}`)} onChange={(e) => setText(`void:${inv.id}`, e.target.value)} style={{ ...input, width: 190 }} />
      <button type="button" disabled={busy !== null || !text(`void:${inv.id}`).trim()} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'void', reason: text(`void:${inv.id}`) })} style={secondaryBtn}>
        <X size={14} /> Void (no invoice)
      </button>
    </>
  );
  const previewPanel = (inv: Invoice) => previews[inv.id] && <PreviewPanel p={previews[inv.id]} onClose={() => setPreviews((p) => { const n = { ...p }; delete n[inv.id]; return n; })} />;
  const problemList = (inv: Invoice) => inv.problems.length > 0 && (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
      {inv.problems.map((p) => <li key={p}>{p}</li>)}
    </ul>
  );

  return (
    <WorkspaceChrome pageLabel="Invoices">
      <div style={{ padding: '20px 16px 40px', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Fatture elettroniche</h1>
          <p style={muted}>
            Every paid Stripe sale appears here. Preview it, issue it, download the XML and upload it in Fatture e Corrispettivi
            (Agenzia delle Entrate), then mark it sent. Issue within {ISSUE_WITHIN_DAYS} days of the payment.
            A Stripe receipt is not a fattura; an XML file here is not transmitted until you upload it.
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
            : <p style={muted}>Business identity, fiscal regime, numbering, wording, VAT treatment by product and customer, stamp duty, foreign customer identification — and what awaits your commercialista.</p>}
        </section>

        {data && data.webhookErrors.length > 0 && (
          <section role="alert" style={{ ...card, borderColor: 'rgba(255,69,58,0.6)' }}>
            <h2 style={h2}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Stripe events that failed ({data.webhookErrors.length})</h2>
            <p style={muted}>Stripe retries each for up to 3 days; an entry disappears once a retry succeeds. A sale behind a failed event may be missing below.</p>
            {data.webhookErrors.map((e) => (
              <div key={e.event_id} style={row}>
                <p style={{ margin: 0, fontSize: 13 }}><strong>{e.event_type}</strong> · {e.livemode === false ? 'TEST' : 'live'} · {e.event_id} · {e.attempts} attempt{e.attempts === 1 ? '' : 's'}, last {fmt(e.last_failed_at)}</p>
                <p style={{ ...muted, wordBreak: 'break-word' }}>{e.error}</p>
              </div>
            ))}
          </section>
        )}

        {data && data.euB2cThisYearCents > 0 && (
          <p role="status" style={{ ...card, margin: 0, fontSize: 13 }}>
            EU private customers in {data.year}: <strong>{formatPrice(data.euB2cThisYearCents / 100)}</strong> so far.
            Their VAT treatment (OSS) is pending your commercialista.
          </p>
        )}

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{error}</p>}
        {!data && !error && <p style={muted}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2 }} /> Loading…</p>}

        {data && (
          <section style={card}>
            <h2 style={h2}>To issue ({toIssue.length})</h2>
            {toIssue.length === 0 && <p style={muted}>Nothing to issue.</p>}
            {toIssue.map((inv) => {
              const due = new Date(new Date(inv.paid_at).getTime() + ISSUE_WITHIN_DAYS * 86400000);
              const overdue = due.getTime() < Date.now();
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
                  {problemList(inv)}
                  <div style={controls}>
                    {productPicker(inv)}
                    <label style={label}>Number
                      <input inputMode="numeric" value={number} onChange={(e) => setNumbers((n) => ({ ...n, [inv.id]: e.target.value }))} style={{ ...input, width: 90 }} />
                    </label>
                    <label style={label}>Date
                      <input type="date" value={date} onChange={(e) => setDates((d) => ({ ...d, [inv.id]: e.target.value }))} style={input} />
                    </label>
                    <button type="button" disabled={busy !== null} onClick={() => void preview(inv.id, number, date)} style={secondaryBtn}>
                      {busy === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
                    </button>
                    <button
                      type="button"
                      disabled={blocked || busy !== null || !number}
                      onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/issue`, { number: Number(number), date, confirmGap: !!gapOk[inv.id] })}
                      style={primaryBtn}
                    >
                      <FileText size={14} /> {number ? `Issue n. ${number}` : 'Issue'}
                    </button>
                  </div>
                  {gapAsk[inv.id] !== undefined && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
                      <input type="checkbox" checked={!!gapOk[inv.id]} onChange={(e) => setGapOk((g) => ({ ...g, [inv.id]: e.target.checked }))} style={{ width: 18, height: 18 }} />
                      Numbers from {gapAsk[inv.id]} up to {Number(number) - 1} were used elsewhere (e.g. FatturAE) — skip them
                    </label>
                  )}
                  <div style={controls}>{voidControls(inv)}</div>
                  {previewPanel(inv)}
                </div>
              );
            })}
            {toIssue.length > 1 && (
              <p style={{ ...muted, marginTop: 8 }}>Numbers are proposed in payment order. Issue them in that order, or change them.</p>
            )}
          </section>
        )}

        {data && (
          <section style={card}>
            <h2 style={h2}>Review queue — past payments ({review.length})</h2>
            <p style={muted}>
              Historical Stripe payments imported for review. Nothing here is invoiced automatically. For each one, choose:
              it still needs an invoice (→ To issue), you already invoiced it elsewhere (give the number), or no invoice is due (void, with the reason).
            </p>
            {review.map((inv) => (
              <div key={inv.id} style={row}>
                <Summary inv={inv} />
                <p style={muted}>Paid {fmt(inv.paid_at)} · {inv.stripe_checkout_session_id ?? inv.stripe_invoice_id}</p>
                {problemList(inv)}
                <div style={controls}>
                  {productPicker(inv)}
                  <button type="button" disabled={busy !== null} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'to_issue' })} style={primaryBtn}>
                    <FileText size={14} /> Needs an invoice → To issue
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void preview(inv.id, '', data.today)} style={secondaryBtn}>
                    <Eye size={14} /> Preview
                  </button>
                </div>
                <div style={controls}>
                  <input aria-label="Where it was invoiced" placeholder="e.g. FatturAE 63/2026" value={text(`ext:${inv.id}`)} onChange={(e) => setText(`ext:${inv.id}`, e.target.value)} style={{ ...input, width: 190 }} />
                  <button type="button" disabled={busy !== null || !text(`ext:${inv.id}`).trim()} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'external', reference: text(`ext:${inv.id}`) })} style={secondaryBtn}>
                    <Check size={14} /> Already invoiced elsewhere
                  </button>
                  {voidControls(inv)}
                </div>
                {previewPanel(inv)}
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <h3 style={{ ...h2, fontSize: 14 }}>Find Stripe payments with no record</h3>
              <MissingCard onChanged={() => void load()} />
            </div>
          </section>
        )}

        {data && tests.length > 0 && (
          <section style={card}>
            <h2 style={h2}>Test-mode payments ({tests.length})</h2>
            <p style={muted}>Recorded from Stripe test mode. They can be previewed (to check the XML) but never issued, and they never use a number.</p>
            {tests.map((inv) => (
              <div key={inv.id} style={row}>
                <Summary inv={inv} />
                {problemList(inv)}
                <div style={controls}>
                  {productPicker(inv)}
                  <button type="button" disabled={busy !== null} onClick={() => void preview(inv.id, '', data.today)} style={secondaryBtn}>
                    {busy === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
                  </button>
                  {voidControls(inv)}
                </div>
                {previewPanel(inv)}
              </div>
            ))}
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
                  {' · '}{inv.status === 'sent' ? `uploaded to SdI${inv.sdi_id ? ` (SdI ${inv.sdi_id})` : ''}` : 'XML ready — NOT transmitted yet: upload it, then mark sent'}
                </p>
                <div style={controls}>
                  <a href={`/api/admin/invoices/${inv.id}/xml`} style={{ ...secondaryBtn, textDecoration: 'none' }}>
                    <Download size={14} /> {inv.xml_file_name ?? 'XML'}
                  </a>
                  {inv.status === 'issued' && (
                    <>
                      <input aria-label="SdI identifier" placeholder="SdI id (optional)" value={text(`sdi:${inv.id}`)} onChange={(e) => setText(`sdi:${inv.id}`, e.target.value)} style={{ ...input, width: 150 }} />
                      <button type="button" disabled={busy !== null} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'sent', sdiId: text(`sdi:${inv.id}`) })} style={primaryBtn}>
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

        {data && closed.length > 0 && (
          <details style={card}>
            <summary style={{ ...h2, cursor: 'pointer' }}>Invoiced elsewhere or voided ({closed.length})</summary>
            {closed.map((inv) => (
              <div key={inv.id} style={row}>
                <Summary inv={inv} />
                <p style={muted}>
                  {inv.status === 'external' ? `Invoiced elsewhere: ${inv.external_reference ?? '—'}` : `Void: ${inv.void_reason ?? '—'}`}
                </p>
                <div style={controls}>
                  <button type="button" disabled={busy !== null} onClick={() => void act(inv.id, `/api/admin/invoices/${inv.id}/status`, { action: 'reopen' })} style={secondaryBtn}>
                    <RotateCcw size={14} /> Back to review
                  </button>
                </div>
              </div>
            ))}
          </details>
        )}
      </div>
    </WorkspaceChrome>
  );
}

function PreviewPanel({ p, onClose }: { p: Preview; onClose: () => void }) {
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: '1px dashed rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>PREVIEW — not an invoice (n. {p.number}, {p.date})</strong>
        <button type="button" onClick={onClose} aria-label="Close preview" style={{ ...secondaryBtn, minHeight: 32, padding: '4px 8px' }}><X size={14} /></button>
      </div>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, fontSize: 13, lineHeight: 1.6 }}>
        {p.checks.map((c) => (
          <li key={c.label}>
            <span aria-hidden style={{ color: c.ok ? 'var(--cl-success-text, #30d158)' : 'var(--cl-destructive-text)', fontWeight: 800 }}>{c.ok ? '✓' : '✗'}</span>{' '}
            {c.label}{c.detail ? <span style={{ opacity: 0.75 }}> — {c.detail}</span> : null}
          </li>
        ))}
      </ul>
      {p.problems.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
          {p.problems.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      {p.xml && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>XML ({p.fileName})</summary>
          <pre style={{ margin: '6px 0 0', maxHeight: 280, overflow: 'auto', fontSize: 11, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{p.xml}</pre>
        </details>
      )}
    </div>
  );
}

function Summary({ inv }: { inv: Invoice }) {
  const who = inv.business_name || inv.customer_name || inv.customer_email || '—';
  const what = inv.source === 'one_off'
    ? `One-off${inv.product_description ? `: ${inv.product_description}` : ''}`
    : inv.plan ? `Subscription: ${inv.plan.charAt(0).toUpperCase()}${inv.plan.slice(1)} ${inv.billing_interval === 'year' ? 'yearly' : inv.billing_interval === 'month' ? 'monthly' : ''}` : 'Subscription';
  const category = inv.customer_category ? ` · ${inv.customer_category.replace('_', ' ').replace('NON EU', 'non-EU')}` : '';
  return (
    <p style={{ margin: 0, fontSize: 14 }}>
      {inv.livemode === false && <span style={badge}>TEST</span>}
      {(inv.refunded_amount_cents ?? 0) > 0 && <span style={badge}>REFUNDED {money(inv.refunded_amount_cents ?? 0, inv.currency)}</span>}
      <strong>{who}</strong>{inv.customer_country ? ` · ${inv.customer_country}` : ''}{category}
      {' · '}<strong>{money(inv.amount_cents, inv.currency)}</strong>
      {` · ${what}`}
    </p>
  );
}

const card: React.CSSProperties = { padding: 20, borderRadius: 14, background: 'rgba(15, 15, 18, 0.65)', border: '1px solid rgba(255,255,255,0.12)' };
const row: React.CSSProperties = { padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' };
const controls: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 };
const h2: React.CSSProperties = { margin: '0 0 8px', fontSize: 15, fontWeight: 800 };
const muted: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, opacity: 0.8 };
const badge: React.CSSProperties = { display: 'inline-block', marginRight: 6, padding: '1px 6px', borderRadius: 6, fontSize: 11, fontWeight: 800, border: '1px solid rgba(255,159,10,0.7)', color: 'rgb(255,179,64)' };
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
