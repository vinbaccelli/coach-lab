'use client';

/**
 * Invoice settings (D9) — Vin's fiscal data and invoicing rules, saved in the
 * database (invoice_settings) and never in Vercel. Admin-only via the API.
 *
 * Every fiscal rule has a status: "confirmed" or "pending" (awaiting the
 * commercialista). A sale that depends on a pending rule can be previewed but
 * not issued. The wording is saved exactly as typed: the page only POINTS OUT
 * characters the SdI rejects; replacing them is a button Vin presses.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Save, AlertTriangle, Clock } from 'lucide-react';

type RuleStatus = 'confirmed' | 'pending';
type TaxRule = { nature: string | null; reference?: string | null; status: RuleStatus };
type Row = Record<string, unknown> & {
  tax_rules: Record<string, Record<string, TaxRule>>;
  wording_status: Record<string, RuleStatus>;
  stamp_duty_rules: Record<string, 'applies' | 'not_applicable' | 'pending'>;
};

const PRODUCT_TYPES: Array<[string, string]> = [
  ['software_subscription', 'Anglemotion subscriptions (software)'],
  ['coaching_service', 'Tennis coaching & video analysis'],
  ['digital_product', 'Ebooks & digital one-off products'],
  ['other', 'Other one-off sales'],
];
const CATEGORIES: Array<[string, string]> = [
  ['IT_B2C', 'Italian private'], ['IT_B2B', 'Italian business'], ['EU_B2C', 'EU private'],
  ['EU_B2B', 'EU business'], ['NON_EU_B2C', 'Non-EU private'], ['NON_EU_B2B', 'Non-EU business'],
];
const NATURES = ['N2.2', 'N2.1', 'N1', 'N3.1', 'N3.2', 'N3.3', 'N3.4', 'N3.5', 'N3.6', 'N4', 'N5', 'N6.1', 'N6.2', 'N6.3', 'N6.4', 'N6.5', 'N6.6', 'N6.7', 'N6.8', 'N6.9', 'N7'];

type Field = { key: string; label: string; hint?: string; wide?: boolean; kind?: 'bool' | 'number' };
const SELLER: Field[] = [
  { key: 'seller_first_name', label: 'First name' },
  { key: 'seller_last_name', label: 'Last name' },
  { key: 'seller_address', label: 'Address (street and number)', wide: true },
  { key: 'seller_cap', label: 'CAP' },
  { key: 'seller_city', label: 'City (Comune)' },
  { key: 'seller_province', label: 'Province', hint: '2 letters, e.g. MI' },
  { key: 'seller_country', label: 'Country', hint: 'IT' },
  { key: 'seller_partita_iva', label: 'Partita IVA', hint: '11 digits' },
  { key: 'seller_codice_fiscale', label: 'Codice Fiscale', hint: '16 characters' },
  { key: 'seller_regime_fiscale', label: 'Regime fiscale', hint: 'RF19 = forfettario' },
  { key: 'payment_method', label: 'Payment method code', hint: 'MP08 = card' },
  {
    key: 'seller_ateco', label: 'ATECO code(s)', wide: true,
    hint: 'For your records — not written on the XML, and nothing here depends on it. List every code you hold, e.g. "85.51.01 (Pilates teaching); <your software code>".',
  },
];
const SDI: Field[] = [
  { key: 'seller_pec', label: 'Your PEC' },
  { key: 'seller_codice_destinatario', label: 'Your Codice Destinatario' },
];
const NUMBERING: Field[] = [
  { key: 'last_issued_year', label: 'Year of your last invoice issued elsewhere', kind: 'number' },
  { key: 'last_issued_number', label: 'Its number', kind: 'number', hint: 'The next proposed number is this + 1 (and after the last one issued here).' },
  { key: 'description_subscription', label: 'Subscription line', wide: true, hint: '{plan} {interval} {start} {end}' },
  { key: 'description_one_off', label: 'One-off sale line', wide: true, hint: '{product} = what was bought' },
];

export default function SettingsCard({ onSaved }: { onSaved: () => void }) {
  const [row, setRow] = useState<Row | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = (b: { settings: Row; problems?: string[]; pending?: string[] }) => {
    setRow(b.settings);
    setProblems(b.problems ?? []);
    setPending(b.pending ?? []);
  };

  useEffect(() => {
    fetch('/api/admin/invoice-settings', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? `Could not load settings (${r.status})`);
        apply(b);
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
      apply(b);
      setMsg('Saved.');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  if (err && !row) return <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--cl-destructive-text)', fontWeight: 600 }}>{err}</p>;
  if (!row) return <p style={muted}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2 }} /> Loading settings…</p>;

  const set = (k: string, v: unknown) => { setRow((r) => ({ ...r!, [k]: v })); setMsg(null); };
  const setRule = (pt: string, c: string, patch: Partial<TaxRule>) => {
    setRow((r) => ({ ...r!, tax_rules: { ...r!.tax_rules, [pt]: { ...r!.tax_rules[pt], [c]: { ...r!.tax_rules[pt][c], ...patch } } } }));
    setMsg(null);
  };
  const wording = String(row.regime_wording ?? '');
  const badChars = [...new Set([...wording].filter((ch) => { const c = ch.codePointAt(0)!; return !(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)); }))];
  const natures = [...new Set([
    'N2.2', 'N2.1',
    ...Object.values(row.tax_rules).flatMap((byCat) => Object.values(byCat).map((r) => r.nature)).filter((v): v is string => !!v),
    ...Object.keys(row.stamp_duty_rules),
  ])];

  const fields = (list: Field[]) => (
    <div className="inv-grid">
      {list.map((f) => (
        <label key={f.key} style={{ ...label, gridColumn: f.wide ? '1 / -1' : undefined }}>
          {f.label}
          {f.kind === 'bool' ? (
            <input type="checkbox" checked={row[f.key] !== false} onChange={(e) => set(f.key, e.target.checked)} style={{ width: 20, height: 20 }} />
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
          {f.hint && <span style={hint}>{f.hint}</span>}
        </label>
      ))}
    </div>
  );

  return (
    <form onSubmit={save} noValidate>
      {problems.length > 0 && (
        <div role="status" style={{ ...notice, borderColor: 'rgba(255,159,10,0.6)' }}>
          <p style={{ margin: 0, fontWeight: 700 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Missing or invalid — no invoice can be issued until fixed</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {pending.length > 0 && (
        <details style={notice}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}><Clock size={14} style={{ verticalAlign: -2 }} /> Awaiting your commercialista ({pending.length})</summary>
          <p style={{ ...muted, margin: '6px 0 0' }}>Sales that depend on these can be previewed, not issued. Set a rule to “confirmed” only once your commercialista has confirmed it.</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{pending.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      )}

      <Group title="Business identity and fiscal regime">{fields(SELLER)}</Group>
      <Group title="Your SdI reception details" note="For reference only — outgoing invoices do not carry them.">{fields(SDI)}</Group>
      <Group title="Numbering and document" note="Document type TD01 (fattura), format FPR12. Numbers are sequential per year and unique — two invoices can never get the same number.">{fields(NUMBERING)}</Group>

      <Group title="Standard wording (Causale)" note="Saved exactly as typed. It is printed on every invoice; whether it fits each product type is confirmed below.">
        <label style={label}>
          Wording
          <textarea value={wording} onChange={(e) => set('regime_wording', e.target.value)} rows={5} style={{ ...input, minHeight: 110, padding: 10, fontFamily: 'inherit' }} />
        </label>
        {badChars.length > 0 && (
          <div role="alert" style={{ ...notice, borderColor: 'rgba(255,159,10,0.6)', marginTop: 8 }}>
            The SdI accepts only Latin-1 characters. This text contains {badChars.map((c) => `“${c}”`).join(', ')}, so invoices would be rejected.
            {' '}It is not changed unless you press:
            {badChars.every((c) => c === '’' || c === '‘') && (
              <div><button type="button" onClick={() => set('regime_wording', wording.replace(/[’‘]/g, "'"))} style={{ ...secondaryBtn, marginTop: 8 }}>Replace ’ with ' (then Save)</button></div>
            )}
          </div>
        )}
        <div className="inv-grid" style={{ marginTop: 10 }}>
          {PRODUCT_TYPES.map(([pt, name]) => (
            <label key={pt} style={label}>
              {name}
              <StatusSelect value={row.wording_status[pt] ?? 'pending'} onChange={(v) => set('wording_status', { ...row.wording_status, [pt]: v })} />
            </label>
          ))}
        </div>
      </Group>

      <Group
        title="VAT treatment by product and customer"
        note="Natura code per product type and customer category. “Not decided” or “pending” blocks issuing for those sales. Legal reference = optional RiferimentoNormativo (≤100 characters)."
      >
        {PRODUCT_TYPES.map(([pt, name]) => (
          <details key={pt} style={{ ...notice, margin: '8px 0 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
              {name}
              <span style={{ ...hint, marginLeft: 8 }}>
                {Object.values(row.tax_rules[pt] ?? {}).filter((r) => r.nature && r.status === 'confirmed').length}/6 confirmed
              </span>
            </summary>
            {CATEGORIES.map(([c, cname]) => {
              const r = row.tax_rules[pt]?.[c] ?? { nature: null, status: 'pending' as RuleStatus };
              return (
                <div key={c} className="inv-rule">
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{cname}</span>
                  <select aria-label={`${name} — ${cname} — Natura`} value={r.nature ?? ''} onChange={(e) => setRule(pt, c, { nature: e.target.value || null })} style={input}>
                    <option value="">— not decided —</option>
                    {NATURES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <StatusSelect label={`${name} — ${cname} — status`} value={r.status} onChange={(v) => setRule(pt, c, { status: v })} />
                  <input aria-label={`${name} — ${cname} — legal reference`} placeholder="Legal reference (optional)" value={r.reference ?? ''} onChange={(e) => setRule(pt, c, { reference: e.target.value })} style={input} />
                </div>
              );
            })}
          </details>
        ))}
      </Group>

      <Group title="Stamp duty (imposta di bollo)" note="Absorbed by you: declared on the invoice (BolloVirtuale), never added to what the customer paid. A €200 payment gives a €200 invoice.">
        {fields([
          { key: 'stamp_duty_enabled', label: 'Declare stamp duty', kind: 'bool' },
          { key: 'stamp_duty_threshold', label: 'Only above (€)', kind: 'number' },
          { key: 'stamp_duty_amount', label: 'Amount (€)', kind: 'number' },
        ])}
        <div className="inv-grid" style={{ marginTop: 10 }}>
          {natures.map((n) => (
            <label key={n} style={label}>
              On {n} invoices
              <select value={row.stamp_duty_rules[n] ?? 'pending'} onChange={(e) => set('stamp_duty_rules', { ...row.stamp_duty_rules, [n]: e.target.value })} style={input}>
                <option value="applies">Applies (confirmed)</option>
                <option value="not_applicable">Does not apply (confirmed)</option>
                <option value="pending">Pending — ask your commercialista</option>
              </select>
            </label>
          ))}
        </div>
      </Group>

      <Group title="Foreign customer identification" note="Separate from the VAT treatment. Foreign customers get recipient code XXXXXXX; they are never asked for an Italian Codice Fiscale. Their real address and postcode are kept.">
        <div className="inv-grid">
          <label style={label}>
            Identifier for foreign private customers (no VAT number)
            <input value={String(row.foreign_private_id ?? '')} onChange={(e) => set('foreign_private_id', e.target.value)} spellCheck={false} autoComplete="off" style={input} />
            <span style={hint}>Written as IdPaese (first 2 letters) + IdCodice, e.g. OO99999999999.</span>
          </label>
          <label style={label}>
            Status
            <StatusSelect value={(row.foreign_private_id_status as RuleStatus) ?? 'pending'} onChange={(v) => set('foreign_private_id_status', v)} />
          </label>
        </div>
      </Group>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save settings
        </button>
        {msg && <span role="status" style={{ fontSize: 12, fontWeight: 600 }}>{msg}</span>}
        {err && <span role="alert" style={{ fontSize: 12, fontWeight: 600, color: 'var(--cl-destructive-text)' }}>{err}</span>}
      </div>
      <style>{`.inv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
        .inv-rule { display: grid; grid-template-columns: 130px 140px 170px minmax(0, 1fr); gap: 8px; align-items: center; margin-top: 8px; }
        @media (max-width: 720px) { .inv-rule { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .inv-rule > span { grid-column: 1 / -1; } .inv-rule > input { grid-column: 1 / -1; } }
        @media (max-width: 560px) { .inv-grid { grid-template-columns: minmax(0, 1fr); } }`}</style>
    </form>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '18px 0 0', minWidth: 0 }}>
      <legend style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{title}</legend>
      {note && <p style={{ ...muted, margin: '0 0 8px' }}>{note}</p>}
      {children}
    </fieldset>
  );
}

function StatusSelect({ value, onChange, label: aria }: { value: RuleStatus; onChange: (v: RuleStatus) => void; label?: string }) {
  return (
    <select aria-label={aria} value={value} onChange={(e) => onChange(e.target.value as RuleStatus)} style={input}>
      <option value="confirmed">Confirmed</option>
      <option value="pending">Pending commercialista</option>
    </select>
  );
}

const muted: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, opacity: 0.8 };
const hint: React.CSSProperties = { fontSize: 12, fontWeight: 400, opacity: 0.7 };
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
const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 40, borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'var(--cl-text-on-fill)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
