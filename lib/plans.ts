/**
 * Subscription plans — single source of truth for features, seats and the copy
 * that describes them. Consumed by the landing page, /pricing, /billing, the
 * checkout route and the Stripe webhook (which maps a purchased price back to a
 * plan through lib/stripe.ts).
 *
 * PRICES ARE NOT HERE. The amount of every plan and cycle is read from the
 * Stripe Price its env var points at (lib/billing/livePrices.ts, cached one
 * hour) and passed to the helpers below as a PlanPrices object. Changing a
 * price = create a new Price in Stripe, point the env var at it, redeploy —
 * no code change (docs/STRIPE_LAUNCH_SETUP.md "Changing a price").
 * Plus the free hour of every tool (DEMO) for every account.
 *
 * Copy rules this file is held to:
 *  - No hardcoded amounts. No competitor prices, no "future features", no
 *    promise that a price is locked.
 *  - Displayed prices are FINAL — nothing is added at checkout. The one line
 *    that says so is PRICE_TAX_NOTE; its wording is pending Vin's accountant,
 *    so it lives in exactly one place. Never write "VAT included".
 *  - Every feature listed per plan is one lib/entitlements.ts actually grants
 *    that plan.
 */

export type PlanId = 'light' | 'pro' | 'academy';
export type BillingCycle = 'monthly' | 'yearly';

export interface Plan {
  id: PlanId;
  name: string;
  /** Who the tier is for — one line, shown under the name on both surfaces. */
  tagline: string;
  /** Coaches who can sign in on this plan, owner included. */
  seats: number;
  featured?: boolean;
  features: string[];
  /** Shown only when the yearly cycle is selected. */
  yearlyBonus?: string;
}

/**
 * The ONE currency setting. Read by formatPrice (display), the checkout price
 * guard (lib/billing/checkoutGuard.ts — a Stripe price in any other currency is
 * refused) and documented for the Stripe prices in docs/STRIPE_LAUNCH_SETUP.md.
 */
export const PRICE_CURRENCY = 'EUR';

/** "€12.90", "€129", "€24.92" — two decimals unless the amount is whole. */
export function formatPrice(amount: number): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: PRICE_CURRENCY,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** formatPrice, or "—" when the plan/cycle has no live price right now. */
export function formatMaybePrice(amount: number | null): string {
  return amount === null ? '—' : formatPrice(amount);
}

/**
 * The single tax line shown beside prices. Displayed prices are final and
 * nothing is added at checkout (Stripe automatic tax is OFF). Change the
 * wording here and only here.
 */
export const PRICE_TAX_NOTE = 'Prices are final: no extra taxes at checkout.';

/** The label above a price. No lock-in promise is made. */
export const PRICING_LABEL = 'Launch pricing';

/** Headline for the pricing surface. */
export const PRICING_HEADLINE = 'Three plans. No storage caps on any of them.';
export const PRICING_SUBHEAD =
  'Your videos live on your YouTube. Your reports live in your Google Docs. No per-video fees, no lock-in, no tier that holds your footage hostage.';
export const PRICING_FOOTNOTE =
  'Every account starts with one free hour of every tool. No card needed to look around.';

export const EBOOK_TITLE = 'Spin Mechanics';

/** Where coaches write when something billing-related needs a human (same address as /terms and /privacy). */
export const SUPPORT_EMAIL = 'vinbaccelli@gmail.com';
const EBOOK_BONUS = `Yearly includes the ${EBOOK_TITLE} ebook, downloadable from your account.`;

export const PLANS: Plan[] = [
  {
    id: 'light',
    name: 'Light',
    tagline: 'For players and coaches who want to measure and mark up a stroke.',
    seats: 1,
    features: [
      'Every drawing tool: lines, arrows, angles, shapes and text',
      'Ruler, joint chain and angle differential',
      'AI skeleton',
      'AI Detect Angles, every reading yours to edit',
      'Data column beside the player',
      'One snapshot: the frame AI Detect Angles captures',
      'Screenshots',
      'AngleMotion Academy',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For coaches running a coaching business.',
    seats: 1,
    featured: true,
    features: [
      'Everything in Light',
      'Recording Hub: screen, webcam and mic',
      'Motion Layer composites',
      'YouTube upload',
      'Player database, and saving to a player from the analysis screen',
      'AI Track: precision skeleton tracking',
      'Generate: phase captures and slow-motion replay',
      'Multi-phase snapshots',
      'Manual match analyzer and Match Decoder',
      'Google Docs report export',
      'Your public coach profile',
    ],
    yearlyBonus: EBOOK_BONUS,
  },
  {
    id: 'academy',
    name: 'Academy',
    tagline: 'For academies and multi-coach teams.',
    seats: 4,
    features: [
      'Everything in Pro',
      'Up to 4 coaches: you plus 3',
      'One subscription, central billing',
    ],
    yearlyBonus: EBOOK_BONUS,
  },
];

/**
 * Free 1-hour self-serve trial — NOT a booking link. Signing in with Google
 * grants one hour of full access to every tool (gated in middleware.ts, one hour
 * per account), then prompts to subscribe.
 */
export const DEMO = {
  label: 'Test it free for an hour',
  note: 'Sign in with Google and use every tool free for one hour — no card, no booking.',
  /** Routes to Google sign-in, then straight into the app for the trial hour. */
  url: '/login?redirect=/analysis',
};

export function getPlan(id: PlanId): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/**
 * Amounts in PRICE_CURRENCY per plan and cycle, as Stripe holds them right now
 * (lib/billing/livePrices.ts). null = that plan/cycle is not on sale (env var
 * unset, price archived or in the wrong currency/interval, or Stripe
 * unreachable) — surfaces show "—" and checkout refuses it anyway.
 */
export type PlanPrices = Record<PlanId, Record<BillingCycle, number | null>>;

export const NO_PRICES: PlanPrices = {
  light: { monthly: null, yearly: null },
  pro: { monthly: null, yearly: null },
  academy: { monthly: null, yearly: null },
};

export function planPrice(prices: PlanPrices, plan: PlanId, cycle: BillingCycle): number | null {
  return prices[plan]?.[cycle] ?? null;
}

/** Yearly price spread over 12 months, to the cent (Pro at €299: 24.92). */
export function yearlyPerMonth(prices: PlanPrices, plan: PlanId): number | null {
  const yearly = planPrice(prices, plan, 'yearly');
  return yearly === null ? null : Math.round((yearly / 12) * 100) / 100;
}

/**
 * Saving of yearly over 12 monthly payments, in percent to one decimal
 * (€129 vs €12.90/mo: 16.7). null when either price is missing or yearly saves
 * nothing — no saving is ever advertised that the prices don't produce.
 */
export function yearlySavingsPct(prices: PlanPrices, plan: PlanId): number | null {
  const monthly = planPrice(prices, plan, 'monthly');
  const yearly = planPrice(prices, plan, 'yearly');
  if (monthly === null || yearly === null || monthly <= 0) return null;
  const pct = Math.round((1 - yearly / (monthly * 12)) * 1000) / 10;
  return pct > 0 ? pct : null;
}

/** "Save 16.7%: two months free" when yearly = 10 × monthly, "Save 28.6%" otherwise, null when no saving. */
export function yearlySavingsLabel(prices: PlanPrices, plan: PlanId): string | null {
  const pct = yearlySavingsPct(prices, plan);
  if (pct === null) return null;
  const monthly = planPrice(prices, plan, 'monthly')!;
  const yearly = planPrice(prices, plan, 'yearly')!;
  const twoMonthsFree = Math.round(monthly * 10 * 100) === Math.round(yearly * 100);
  return twoMonthsFree ? `Save ${pct}%: two months free` : `Save ${pct}%`;
}

/** Largest yearly saving across the plans — for "save up to …" toggles. null when none. */
export function maxYearlySavingsPct(prices: PlanPrices): number | null {
  const all = PLANS.map((p) => yearlySavingsPct(prices, p.id)).filter((v): v is number => v !== null);
  return all.length ? Math.max(...all) : null;
}

/**
 * One sentence on what yearly saves, built from the live prices for the FAQs
 * ("16.7% less on Light (two months free), 28.6% less on Pro and Academy").
 * null when no plan currently saves anything on yearly.
 */
export function yearlySavingsSentence(prices: PlanPrices): string | null {
  const groups = new Map<string, string[]>();
  for (const p of PLANS) {
    const label = yearlySavingsLabel(prices, p.id);
    const pct = yearlySavingsPct(prices, p.id);
    if (!label || pct === null) continue;
    const key = label.endsWith('two months free') ? `${pct}% less on {names} (two months free)` : `${pct}% less on {names}`;
    groups.set(key, [...(groups.get(key) ?? []), p.name]);
  }
  if (!groups.size) return null;
  const parts = [...groups].map(([k, names]) =>
    k.replace('{names}', names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]));
  return `Yearly costs less than twelve monthly payments: ${parts.join(', and ')}.`;
}

export function isValidPlanId(v: unknown): v is PlanId {
  return v === 'light' || v === 'pro' || v === 'academy';
}
