/**
 * Subscription plans — single source of truth for prices, features, seats and
 * the copy that describes them. Consumed by the landing page, /pricing,
 * /billing, the checkout route and the Stripe webhook (which maps a purchased
 * price back to a plan through lib/stripe.ts).
 *
 * Launch pricing, in EUR (Vin, 2026-10-03):
 *   Light    €12.90/mo  €129/yr   1 coach
 *   Pro      €34.90/mo  €299/yr   1 coach
 *   Academy  €69.90/mo  €599/yr   up to 4 coaches (owner + 3)
 * Plus the free hour of every tool (DEMO) for every account.
 *
 * Copy rules this file is held to:
 *  - Only these numbers. No competitor prices, no "future features", no
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
  /** EUR. */
  priceMonthly: number;
  /** EUR. */
  priceYearly: number;
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
const EBOOK_BONUS = `Yearly includes the ${EBOOK_TITLE} ebook, downloadable from your account.`;

export const PLANS: Plan[] = [
  {
    id: 'light',
    name: 'Light',
    tagline: 'For players and coaches who want to measure and mark up a stroke.',
    priceMonthly: 12.9,
    priceYearly: 129,
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
    priceMonthly: 34.9,
    priceYearly: 299,
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
    priceMonthly: 69.9,
    priceYearly: 599,
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

export function planPrice(plan: Plan, cycle: BillingCycle): number {
  return cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
}

/** Yearly price spread over 12 months, to the cent (Pro: 299 / 12 = 24.92). */
export function yearlyPerMonth(plan: Plan): number {
  return Math.round((plan.priceYearly / 12) * 100) / 100;
}

/** Saving of yearly over 12 monthly payments, in percent to one decimal (Light 16.7, Pro 28.6). */
export function yearlySavingsPct(plan: Plan): number {
  return Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 1000) / 10;
}

/** "Save 16.7%: two months free" for Light (129 = 10 × 12.90), "Save 28.6%" otherwise. */
export function yearlySavingsLabel(plan: Plan): string {
  const pct = yearlySavingsPct(plan);
  const twoMonthsFree = Math.round(plan.priceMonthly * 10 * 100) === Math.round(plan.priceYearly * 100);
  return twoMonthsFree ? `Save ${pct}%: two months free` : `Save ${pct}%`;
}

/** Largest yearly saving across the plans — for "save up to …" toggles. */
export function maxYearlySavingsPct(): number {
  return Math.max(...PLANS.map(yearlySavingsPct));
}

export function isValidPlanId(v: unknown): v is PlanId {
  return v === 'light' || v === 'pro' || v === 'academy';
}
