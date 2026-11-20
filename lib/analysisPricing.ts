/**
 * Analysis subscriptions on the coach profile (docs/ANALYSIS_SUBSCRIPTIONS_PLAN.md, increment 1).
 *
 * Pure functions only: how often (weekly / every 2 weeks / monthly), how to pay for a
 * discount (monthly for 12 months 10%, 6 months in advance 10%, 12 months in advance 20%),
 * the exact total the client sees, and the sanitizer for what a coach saves. The app never
 * touches money: the coach pastes a payment link per term and the client pays there.
 *
 * Discounts are configured here, once, so every coach offers the same terms.
 */

export type Frequency = 'weekly' | 'biweekly' | 'monthly';
export type Term = 'monthly12' | 'prepaid6' | 'prepaid12';

export const FREQUENCIES: { id: Frequency; label: string; perMonth: number }[] = [
  { id: 'weekly', label: 'Every week', perMonth: 52 / 12 },
  { id: 'biweekly', label: 'Every 2 weeks', perMonth: 26 / 12 },
  { id: 'monthly', label: 'Once a month', perMonth: 1 },
];

export const TERMS: { id: Term; label: string; months: number; discountPct: number; payUpFront: boolean }[] = [
  { id: 'monthly12', label: 'Monthly, 12 months', months: 12, discountPct: 10, payUpFront: false },
  { id: 'prepaid6', label: '6 months paid in advance', months: 6, discountPct: 10, payUpFront: true },
  { id: 'prepaid12', label: '12 months paid in advance', months: 12, discountPct: 20, payUpFront: true },
];

export interface AnalysisOffer {
  id: string;
  /** e.g. "Quick analysis", "In-depth analysis". */
  title: string;
  description: string;
  /** Price of ONE delivered analysis, in cents. */
  unitCents: number;
  /** ISO 4217, displayed only. */
  currency: string;
}

export interface SubscriptionOffer {
  enabled: boolean;
  offers: AnalysisOffer[];
  /** Frequencies this coach offers. */
  frequencies: Frequency[];
  /** A payment link (or instructions) per term; the coach's own channel. */
  payLinks: Partial<Record<Term, string>>;
}

export const EMPTY_SUBSCRIPTION_OFFER: SubscriptionOffer = {
  enabled: false,
  offers: [],
  frequencies: ['weekly', 'biweekly', 'monthly'],
  payLinks: {},
};

export const MAX_OFFERS = 6;
const MAX_TEXT = 400;
const MAX_URL = 2048;
const MAX_UNIT_CENTS = 10_000_000;

const frequencyOf = (id: Frequency) => FREQUENCIES.find((f) => f.id === id)!;
const termOf = (id: Term) => TERMS.find((t) => t.id === id)!;

/** Deliveries the client receives over the term (rounded, shown to the client). */
export function deliveriesInTerm(frequency: Frequency, term: Term): number {
  return Math.round(frequencyOf(frequency).perMonth * termOf(term).months);
}

export interface PriceQuote {
  deliveries: number;
  unitCents: number;
  discountPct: number;
  /** Before the discount. */
  fullCents: number;
  /** What the client pays over the whole term. */
  totalCents: number;
  savedCents: number;
  /** Prepaid: the whole total once. Monthly: the same total split in `months` payments. */
  payUpFront: boolean;
  /** Per-month payment for the monthly term, else 0. */
  monthlyCents: number;
}

export function quote(unitCents: number, frequency: Frequency, term: Term): PriceQuote {
  const t = termOf(term);
  const deliveries = deliveriesInTerm(frequency, term);
  const fullCents = Math.round(unitCents * deliveries);
  const totalCents = Math.round(fullCents * (1 - t.discountPct / 100));
  return {
    deliveries,
    unitCents,
    discountPct: t.discountPct,
    fullCents,
    totalCents,
    savedCents: fullCents - totalCents,
    payUpFront: t.payUpFront,
    monthlyCents: t.payUpFront ? 0 : Math.round(totalCents / t.months),
  };
}

export function formatMoney(cents: number, currency: string): string {
  const cur = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'EUR';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

/** Only http(s) links; anything else (javascript:, data:) is dropped. */
export function safeHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim().slice(0, MAX_URL);
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
}

const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Clean whatever the editor (or a stored row) holds into a valid SubscriptionOffer. */
export function sanitizeSubscriptionOffer(raw: unknown): SubscriptionOffer {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const offers: AnalysisOffer[] = [];
  const list = Array.isArray(o.offers) ? o.offers : [];
  for (const item of list.slice(0, MAX_OFFERS)) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const title = text(r.title, 80);
    const unit = Math.round(Number(r.unitCents));
    if (!title || !Number.isFinite(unit) || unit <= 0 || unit > MAX_UNIT_CENTS) continue;
    const cur = text(r.currency, 3).toUpperCase();
    offers.push({
      id: text(r.id, 40) || `offer-${offers.length + 1}`,
      title,
      description: text(r.description),
      unitCents: unit,
      currency: /^[A-Z]{3}$/.test(cur) ? cur : 'EUR',
    });
  }
  const freqs = (Array.isArray(o.frequencies) ? o.frequencies : []).filter(
    (f): f is Frequency => FREQUENCIES.some((x) => x.id === f),
  );
  const payLinks: Partial<Record<Term, string>> = {};
  const pl = (o.payLinks && typeof o.payLinks === 'object' ? o.payLinks : {}) as Record<string, unknown>;
  for (const t of TERMS) {
    const url = safeHttpUrl(pl[t.id]);
    if (url) payLinks[t.id] = url;
  }
  return {
    enabled: o.enabled === true && offers.length > 0,
    offers,
    frequencies: freqs.length ? Array.from(new Set(freqs)) : EMPTY_SUBSCRIPTION_OFFER.frequencies,
    payLinks,
  };
}

/**
 * What is missing before the public page shows the subscription. The server drops an analysis type
 * without a title or a price and switches the whole offer off when none is left, so the editor says
 * so (it used to save quietly and show nothing). Empty list = the offer will show.
 */
export function subscriptionProblems(offer: SubscriptionOffer): string[] {
  if (!offer.enabled) return [];
  const problems: string[] = [];
  const incomplete = offer.offers.filter((o) => !text(o.title) || !(Number(o.unitCents) > 0));
  const complete = offer.offers.length - incomplete.length;
  if (complete === 0) problems.push('Add at least one analysis type with a title and a price, or nothing will show on your public page.');
  else if (incomplete.length) problems.push(`${incomplete.length} analysis type${incomplete.length > 1 ? 's' : ''} without a title or a price will not be shown.`);
  const missingLinks = TERMS.filter((t) => !safeHttpUrl(offer.payLinks[t.id]));
  if (missingLinks.length) problems.push(`No payment link yet for: ${missingLinks.map((t) => t.label).join(', ')}. Clients will see that option but cannot pay through it.`);
  return problems;
}
