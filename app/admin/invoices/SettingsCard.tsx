'use client';

/**
 * Invoice settings (D9) — Vin's fiscal data and invoicing rules, saved in the
 * database (invoice_settings) instead of Vercel. Admin-only via the API.
 * Fields marked "pending" wait for the accountant (T2 OSS, D8 stamp duty on
 * N2.1, T3 foreign private identifier); leaving them empty keeps the affected
 * invoices blocked with the reason, never guessed.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Save, AlertTriangle } from 'lucide-react';

type Row = Record<string, string | number | boolean | null>;

type Field = { key: string; label: string; hint?: string; wide?: boolean; textarea?: boolean; kind?: 'bool' | 'number' };
const GROUPS: Array<{ title: string; note?: string; fields: Field[] }> = [
  {
    title: 'Seller (you)',
    fields: [
      { key: 'seller_first_name', label: 'First name' },
      { key: 'seller_last_name', label: 'Last name' },
      { key: 'seller_address', label: 'Address (street and number)', wide: true },
      { key: 'seller_cap', label: 'CAP' },
      { key: 'seller_city', label: 'City (Comune)' },
      { key: 'seller_province', label: 'Province', hint: '2 letters, e.g. MI' },
      { key: 'seller_country', label: 'Country', hint: 'IT' },
      { key: 'seller_partita_iva', label: 'Partita IVA', hint: '11 digits' },
      { key: 'seller_codice_fiscale', label: 'Codice Fiscale' },
      { key: 'seller_regime_fiscale', label: 'Regime fiscale', hint: 'RF19 = forfettario' },
      { key: 'seller_ateco', label: 'ATECO', hint: 'For your records; not printed on the XML. Update when your accountant confirms.' },
    ],
  },
  {
    title: 'SdI (your own reception details)',
    note: 'For reference only — outgoing invoices do not carry them.',
    fields: [
      { key: 'seller_pec', label: 'Your PEC' },
      { key: 'seller_codice_destinatario', label: 'Your Codice Destinatario' },
    ],
  },
  {
    title: 'Forfettario wording',
    fields: [
      { key: 'regime_wording', label: 'Invoice wording (Causale)', hint: 'Exactly the text your accountant gives you. Required before any invoice is issued.', wide: true, textarea: true },
    ],
  },
  {
    title: 'VAT treatment (Natura) per customer',
    note: 'Empty = not decided: those invoices stay blocked until it is set. Legal reference = optional RiferimentoNormativo (≤100 characters).',
    fields: [
      { key: 'nature_it_b2c', label: 'Italian private' }, { key: 'reference_it_b2c', label: 'Legal reference', wide: true },
      { key: 'nature_it_b2b', label: 'Italian business' }, { key: 'reference_it_b2b', label: 'Legal reference', wide: true },
      { key: 'nature_eu_b2b', label: 'EU business' }, { key: 'reference_eu_b2b', label: 'Legal reference', wide: true },
      { key: 'nature_eu_b2c', label: 'EU private — PENDING (T2, OSS)' }, { key: 'reference_eu_b2c', label: 'Legal reference', wide: true },
      { key: 'nature_non_eu_b2c', label: 'Non-EU private' }, { key: 'reference_non_eu_b2c', label: 'Legal reference', wide: true },
      { key: 'nature_non_eu_b2b', label: 'Non-EU business' }, { key: 'reference_non_eu_b2b', label: 'Legal reference', wide: true },
      { key: 'foreign_private_id', label: 'Foreign private customer without tax ID — identifier (PENDING, T3)', wide: true, hint: 'Empty = such invoices stay blocked.' },
    ],
  },
  {
    title: 'Stamp duty (imposta di bollo)',
    note: 'Absorbed by you: declared on the invoice, never added to what the customer paid.',
    fields: [
      { key: 'stamp_duty_enabled', label: 'Declare stamp duty', kind: 'bool' },
      { key: 'stamp_duty_threshold', label: 'Only above (€)', kind: 'number' },
      { key: 'stamp_duty_amount', label: 'Amount (€)', kind: 'number' },
      { key: 'stamp_duty_natures', label: 'For Natura codes', hint: 'Comma-separated. Add N2.1 only once your accountant confirms (D8).' },
    ],
  },
  {
    title: 'Numbering and lines',
    fields: [
      { key: 'last_issued_year', label: 'Year of your last invoice issued elsewhere', kind: 'number' },
      { key: 'last_issued_number', label: 'Its number', kind: 'number', hint: 'The next proposed number is this + 1.' },
      { key: 'description_subscription', label: 'Subscription line', wide: true, hint: '{plan} {interval} {start} {end}' },
      { key: 'description_one_off', label: 'One-off sale line', wide: true, hint: '{product} = what was bought' },
      { key: 'payment_method', label: 'Payment method code', hint: 'MP08 = card' },
    ],
  },
];

export default function SettingsCard({ onSaved }: { onSaved: () => void }) {
  const [row, setRow] = useState<Row | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/invoice-settings', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? `Could not load settings (${r.status})`);
        setRow(b.settings as Row);
        setProblems(b.problems ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load settings'));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/admin/invoice-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(b.error ?? 'Could not save'); return; }
      setRow(b.settings as Row);
      setProblems(b.problems ?? []);
      setMsg('Saved.');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  if (err && !row) return <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{err}</p>;
  if (!row) return <p style={muted}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2 }} /> Loading settings…</p>;

  const set = (k: string, v: string | boolean) => { setRow((r) => ({ ...r!, [k]: v })); setMsg(null); };

  return (
    <form onSubmit={save} noValidate>
      {problems.length > 0 && (
        <div role="status" style={{ ...notice, borderColor: 'rgba(255,159,10,0.6)' }}>
          <p style={{ margin: 0, fontWeight: 700 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Still missing before any invoice can be issued</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {GROUPS.map((g) => (
        <fieldset key={g.title} style={{ border: 'none', padding: 0, margin: '16px 0 0' }}>
          <legend style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{g.title}</legend>
          {g.note && <p style={{ ...muted, margin: '0 0 8px' }}>{g.note}</p>}
          <div className="inv-grid">
            {g.fields.map((f) => (
              <label key={f.key} style={{ ...label, gridColumn: f.wide ? '1 / -1' : undefined }}>
                {f.label}
                {f.kind === 'bool' ? (
                  <input type="checkbox" checked={row[f.key] !== false} onChange={(e) => set(f.key, e.target.checked)} style={{ width: 20, height: 20 }} />
                ) : f.textarea ? (
                  <textarea value={String(row[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} rows={4} style={{ ...input, minHeight: 90, padding: 10, fontFamily: 'inherit' }} />
                ) : (
                  <input
                    value={String(row[f.key] ?? '')}
                    inputMode={f.kind === 'number' ? 'decimal' : undefined}
                    onChange={(e) => set(f.key, e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    style={input}
                  />
                )}
                {f.hint && <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.7 }}>{f.hint}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save settings
        </button>
        {msg && <span role="status" style={{ fontSize: 12, fontWeight: 600 }}>{msg}</span>}
        {err && <span role="alert" style={{ fontSize: 12, fontWeight: 600, color: 'var(--cl-destructive-text)' }}>{err}</span>}
      </div>
      <style>{`.inv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
        @media (max-width: 560px) { .inv-grid { grid-template-columns: minmax(0, 1fr); } }`}</style>
    </form>
  );
}

const muted: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, opacity: 0.8 };
const notice: React.CSSProperties = {
  margin: '0 0 8px', padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
  border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)',
};
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, minWidth: 0 };
const input: React.CSSProperties = {
  minHeight: 40, borderRadius: 10, padding: '0 10px', fontSize: 14, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)', color: 'inherit', minWidth: 0, width: '100%', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 40, borderRadius: 10, border: 'none',
  background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
};
