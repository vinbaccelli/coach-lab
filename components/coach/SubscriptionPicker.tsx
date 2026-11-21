'use client';

/**
 * Public side of the analysis subscription: the client picks the analysis type, how often, and
 * how to pay, and sees the exact total and discount before going to the coach's payment link.
 * No request is stored and no money moves here (increment 1); the link opens in a new tab.
 */

import { useState } from 'react';
import {
  FREQUENCIES, TERMS, quote, formatMoney, payLinkFor, type SubscriptionOffer, type Frequency, type Term,
} from '@/lib/analysisPricing';

export default function SubscriptionPicker({
  offer, accent, embedded = false,
}: { offer: SubscriptionOffer; accent: string; embedded?: boolean }) {
  const [offerId, setOfferId] = useState(offer.offers[0]?.id ?? '');
  const freqs = FREQUENCIES.filter((f) => offer.frequencies.includes(f.id));
  const [frequency, setFrequency] = useState<Frequency>(freqs[0]?.id ?? 'monthly');
  const [term, setTerm] = useState<Term>('prepaid12');
  const chosen = offer.offers.find((o) => o.id === offerId) ?? offer.offers[0];
  if (!chosen) return null;
  const q = quote(chosen.unitCents, frequency, term);
  const money = (c: number) => formatMoney(c, chosen.currency);
  const link = payLinkFor(offer, chosen.id, frequency, term);
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
    border: `1.5px solid ${on ? accent : '#D9D9DE'}`, background: on ? `${accent}14` : '#fff', color: '#1c1c1e',
  });
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, margin: '14px 0 6px', color: '#3a3a3c' };

  return (
    <section data-testid="subscription-picker" aria-label="Video analysis subscription"
      style={embedded ? undefined : { margin: '24px auto', maxWidth: 640, padding: 18, borderRadius: 16, border: '1px solid #E5E5EA', background: '#fff' }}>
      {!embedded && <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Video analysis subscription</h2>}
      <div style={embedded ? { ...label, marginTop: 0 } : label}>Type of analysis</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {offer.offers.map((o) => (
          <button key={o.id} type="button" aria-pressed={o.id === chosen.id} style={chip(o.id === chosen.id)} onClick={() => setOfferId(o.id)}>
            {o.title} · {formatMoney(o.unitCents, o.currency)} each
            {o.description && <div style={{ fontWeight: 400, fontSize: 12, color: '#6e6e73', marginTop: 2 }}>{o.description}</div>}
          </button>
        ))}
      </div>
      <div style={label}>How often</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {freqs.map((f) => (
          <button key={f.id} type="button" aria-pressed={f.id === frequency} style={chip(f.id === frequency)} onClick={() => setFrequency(f.id)}>{f.label}</button>
        ))}
      </div>
      <div style={label}>How to pay</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {TERMS.map((t) => (
          <button key={t.id} type="button" aria-pressed={t.id === term} style={chip(t.id === term)} onClick={() => setTerm(t.id)}>
            {t.label} — {t.discountPct}% off
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: '#F5F5F7', fontSize: 14 }} aria-live="polite">
        <div><strong>{q.deliveries}</strong> analyses · {money(q.unitCents)} each</div>
        <div style={{ marginTop: 4 }}>
          Total <strong>{money(q.totalCents)}</strong>{' '}
          <span style={{ color: '#6e6e73', textDecoration: 'line-through' }}>{money(q.fullCents)}</span>{' '}
          <span style={{ color: '#1a7f37', fontWeight: 600 }}>you save {money(q.savedCents)} ({q.discountPct}%)</span>
        </div>
        {!q.payUpFront && <div style={{ marginTop: 4, color: '#3a3a3c' }}>{money(q.monthlyCents)} a month for 12 months</div>}
      </div>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', marginTop: 14, textAlign: 'center', padding: '12px 16px', borderRadius: 12, background: accent, color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
          Subscribe and pay
        </a>
      ) : (
        <p style={{ marginTop: 14, fontSize: 13, color: '#6e6e73' }}>This coach has not added a payment link for this option yet. Please contact the coach.</p>
      )}
    </section>
  );
}
