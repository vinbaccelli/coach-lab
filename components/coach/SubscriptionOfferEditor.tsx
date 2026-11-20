'use client';

/**
 * Coach side of the analysis subscription (docs/ANALYSIS_SUBSCRIPTIONS_PLAN.md, increment 1):
 * the analysis types and prices, which frequencies to offer, and one payment link per term.
 * The discounts (10 / 10 / 20 %) are fixed in lib/analysisPricing.ts. The app never charges:
 * the client pays through the link the coach pastes here.
 */

import { Plus, Trash2 } from 'lucide-react';
import {
  FREQUENCIES, TERMS, MAX_OFFERS, subscriptionProblems, type SubscriptionOffer, type AnalysisOffer, type Frequency, type Term,
} from '@/lib/analysisPricing';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--cl-border)',
  fontSize: 14, background: '#fff', boxSizing: 'border-box',
};

export default function SubscriptionOfferEditor({
  value, onChange,
}: { value: SubscriptionOffer; onChange: (next: SubscriptionOffer) => void }) {
  const set = (patch: Partial<SubscriptionOffer>) => onChange({ ...value, ...patch });
  const setOffer = (id: string, patch: Partial<AnalysisOffer>) =>
    set({ offers: value.offers.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const addOffer = () => {
    if (value.offers.length >= MAX_OFFERS) return;
    set({
      offers: [...value.offers, {
        id: `offer-${Date.now().toString(36)}`, title: '', description: '', unitCents: 0, currency: 'EUR',
      }],
    });
  };
  const problems = subscriptionProblems(value);
  const toggleEnabled = (on: boolean) => {
    // Switching on with nothing to sell would be dropped by the server: start with one blank type.
    if (on && value.offers.length === 0) {
      set({
        enabled: true,
        offers: [{ id: `offer-${Date.now().toString(36)}`, title: '', description: '', unitCents: 0, currency: 'EUR' }],
      });
    } else set({ enabled: on });
  };
  const toggleFreq = (f: Frequency) => {
    const has = value.frequencies.includes(f);
    const next = has ? value.frequencies.filter((x) => x !== f) : [...value.frequencies, f];
    if (next.length) set({ frequencies: next });
  };
  const setPay = (t: Term, url: string) => set({ payLinks: { ...value.payLinks, [t]: url } });

  return (
    <div data-testid="subscription-editor">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        <input type="checkbox" checked={value.enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        Offer video analysis subscriptions on my public profile
      </label>
      <p style={{ fontSize: 12, color: 'var(--cl-text-muted)', margin: '0 0 14px' }}>
        Your clients pick the analysis type, how often, and how to pay. Paying monthly for 12 months saves them 10%,
        6 months in advance 10%, 12 months in advance 20%. You are paid through your own payment links; AngleMotion
        never handles the money. It needs at least one analysis type with a price.
      </p>

      {problems.length > 0 && (
        <div role="status" data-testid="subscription-problems"
          style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,196,0,0.12)', border: '1px solid rgba(255,196,0,0.45)', fontSize: 12, lineHeight: 1.5 }}>
          {problems.map((m) => <div key={m}>{m}</div>)}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Analysis types</div>
      {value.offers.map((o) => (
        <div key={o.id} style={{ padding: 12, borderRadius: 12, border: '1px solid var(--cl-border)', background: '#FAFAFA', marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px auto', gap: 8, marginBottom: 8 }}>
            <input style={inputStyle} value={o.title} maxLength={80} placeholder="e.g. Quick analysis"
              onChange={(e) => setOffer(o.id, { title: e.target.value })} />
            <input style={inputStyle} inputMode="decimal" placeholder="Price"
              aria-label="Price of one analysis"
              defaultValue={o.unitCents ? (o.unitCents / 100).toString() : ''}
              onChange={(e) => setOffer(o.id, { unitCents: Math.round(parseFloat(e.target.value.replace(',', '.')) * 100) || 0 })} />
            <input style={inputStyle} value={o.currency} maxLength={3} aria-label="Currency"
              onChange={(e) => setOffer(o.id, { currency: e.target.value.toUpperCase() })} />
            <button type="button" aria-label="Remove analysis type"
              onClick={() => set({ offers: value.offers.filter((x) => x.id !== o.id) })}
              style={{ background: 'none', border: 'none', color: 'var(--cl-destructive)', cursor: 'pointer' }}>
              <Trash2 size={14} />
            </button>
          </div>
          <textarea style={{ ...inputStyle, minHeight: 44, resize: 'vertical', fontFamily: 'inherit' }}
            value={o.description} maxLength={400} placeholder="What the client gets (length, format, turnaround…)"
            onChange={(e) => setOffer(o.id, { description: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={addOffer} disabled={value.offers.length >= MAX_OFFERS}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--cl-accent)', background: 'transparent', color: 'var(--cl-accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <Plus size={14} /> Add analysis type
      </button>
      <p style={{ fontSize: 11, color: 'var(--cl-text-muted)', margin: '6px 0 14px' }}>The price is for ONE delivered analysis.</p>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>How often can clients choose</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {FREQUENCIES.map((f) => (
          <label key={f.id} style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={value.frequencies.includes(f.id)} onChange={() => toggleFreq(f.id)} />
            {f.label}
          </label>
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Where clients pay (your link, one per term)</div>
      {TERMS.map((t) => (
        <div key={t.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--cl-text-muted)', marginBottom: 3 }}>
            {t.label} · {t.discountPct}% off
          </div>
          <input style={inputStyle} value={value.payLinks[t.id] ?? ''} placeholder="https://buy.stripe.com/… or your PayPal link"
            onChange={(e) => setPay(t.id, e.target.value)} />
        </div>
      ))}
    </div>
  );
}
