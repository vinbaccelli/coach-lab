/**
 * Subscription plans — single source of truth for pricing, features, seats, and
 * the (plan, cycle) ↔ Stripe price-ID mapping. Consumed by the landing page, the
 * /pricing checkout page, the checkout API route, and the Stripe webhook (which
 * reverse-maps a purchased price back to a tier to store on the subscription).
 *
 * Three tiers + a non-Stripe 1-hour demo CTA. All three are presented as
 * FOUNDING pricing — locked for the life of the membership (see FOUNDING_NOTE):
 *   Light   ($10/mo, $100/yr) — analysis for players and solo coaches
 *   Pro     ($20/mo, $200/yr) — the coaching business tier
 *   Academy ($40/mo, $400/yr) — Pro for up to 5 coaches (multi-user)
 *
 * ⚠️ STRIPE: the LIGHT prices configured in the environment still charge the
 * pre-founding $5/$50. Verified live against the Stripe API on 2026-09-08:
 *   STRIPE_PRICE_LIGHT_MONTHLY  → $5.00/month   (advertised here: $10)
 *   STRIPE_PRICE_LIGHT_YEARLY   → $50.00/year   (advertised here: $100)
 * Pro ($20/$200) and Academy ($40/$400) already match. Two new Stripe prices
 * must be created and those two env vars repointed BEFORE this ships, or Light
 * will advertise $10 and charge $5. See the report accompanying this change.
 */

export type PlanId = 'light' | 'pro' | 'academy';
export type BillingCycle = 'monthly' | 'yearly';

export interface Plan {
  id: PlanId;
  name: string;
  /** Who the tier is for — one line, shown under the name on both surfaces. */
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  /** Coach seats included. Light/Pro = 1, Academy = 5. */
  seats: number;
  featured?: boolean;
  features: string[];
  /** Extra reason to choose annual on this tier, shown only when annual is selected. */
  annualBonus?: string;
  /** A standing note about the tier. Must be a fact, not a slogan. */
  note?: string;
}

/**
 * Founding-pricing promise. Applies ACCOUNT-WIDE to whichever tier a coach joins
 * at — not to one tier — so it is stated once, beside the table, rather than
 * repeated per card.
 */
export const FOUNDING_NOTE =
  'Founding pricing — locked for as long as you’re a member, whatever we charge new subscribers later.';

/** Headline for the pricing surface. */
export const PRICING_HEADLINE = 'Three plans. No storage caps on any of them.';
export const PRICING_SUBHEAD =
  'Your videos live on your YouTube. Your reports live in your Google Docs. No per-video fees, no lock-in, no tier that holds your footage hostage.';
export const PRICING_FOOTNOTE =
  'Start with a free hour on any plan. No credit card to look around.';

export const PLANS: Plan[] = [
  {
    id: 'light',
    name: 'Light',
    tagline: 'For players and coaches who just want to analyze.',
    priceMonthly: 10,
    priceYearly: 100,
    seats: 1,
    features: [
      'Full video analysis with every drawing tool',
      'AI skeleton pose detection',
      'AI angle detection — 13+ angles, always yours to edit',
      'Snapshots and high-res screenshots',
      'Foot direction, hip–shoulder and joint angles',
      'AngleMotion Academy',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For coaches running a coaching business.',
    priceMonthly: 20,
    priceYearly: 200,
    seats: 1,
    featured: true,
    features: [
      'Everything in Light',
      'Motion Layer — you choose the frames, not an algorithm',
      'Live point-by-point match tracking',
      'Match Decoder, straight to the player’s timeline',
      'Charted reports, one click to Google Docs and PDF',
      'Player database with unlimited usage',
      'Recording Hub — webcam, mic, background remover, direct YouTube upload',
      'Your public coach profile with Stripe payment links',
      'Direct WhatsApp support from Vin',
    ],
    // Euro deliberately: this is the ebook's own listed price on the coach
    // profile (lib/coach/curated/vinbaccelli.ts). The subscription stays USD.
    annualBonus:
      'Go annual and I’ll send you my ebook — a €30 value, yours to keep whether you renew or not.',
  },
  {
    id: 'academy',
    name: 'Academy',
    tagline: 'For academies and multi-coach teams.',
    priceMonthly: 40,
    priceYearly: 400,
    seats: 5,
    features: [
      'Everything in Pro',
      'Up to 5 coach seats',
      'One shared subscription, central billing',
    ],
    // Verified on onform.com/pricing 2026-09-09: Coach Pro is $599.99/yr and
    // includes ONE coach seat; their page states "Coach prices multiply by
    // Number of coaches". Five seats there is 5 × $599.99 before an 11%
    // 3+-seat discount — so this comparison understates the gap rather than
    // overstating it. Same sourcing standard as the landing comparison table.
    note: 'OnForm charges $599.99 a year for one coach. This is five.',
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

/** Yearly effective monthly price (2 months free vs monthly). */
export function yearlyPerMonth(plan: Plan): number {
  return Math.round((plan.priceYearly / 12) * 100) / 100;
}

export function isValidPlanId(v: unknown): v is PlanId {
  return v === 'light' || v === 'pro' || v === 'academy';
}
