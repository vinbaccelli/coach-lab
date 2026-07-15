/**
 * Subscription plans — single source of truth for pricing, features, seats, and
 * the (plan, cycle) ↔ Stripe price-ID mapping. Consumed by the landing page, the
 * /pricing checkout page, the checkout API route, and the Stripe webhook (which
 * reverse-maps a purchased price back to a tier to store on the subscription).
 *
 * Three tiers + a non-Stripe 1-hour demo CTA:
 *   Light   ($5/mo,  $50/yr)  — video analysis with metrics (draw, skeleton, screenshots)
 *   Pro     ($20/mo, $200/yr) — everything + AngleMotion Academy
 *   Academy ($40/mo, $400/yr) — Pro for up to 5 coaches (multi-user)
 */

export type PlanId = 'light' | 'pro' | 'academy';
export type BillingCycle = 'monthly' | 'yearly';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  /** Coach seats included. Light/Pro = 1, Academy = 5. */
  seats: number;
  featured?: boolean;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'light',
    name: 'Light',
    tagline: 'Video analysis with metrics.',
    priceMonthly: 5,
    priceYearly: 50,
    seats: 1,
    features: [
      'Video analysis with all drawing tools',
      'AI skeleton pose detection',
      'AI Detect Angles (13+) — always coach-editable',
      'Snapshots + high-res screenshots',
      'Foot direction, hip–shoulder & joint angles',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything, plus the Academy.',
    priceMonthly: 20,
    priceYearly: 200,
    seats: 1,
    featured: true,
    features: [
      'Everything in Light',
      'StroMotion composites (image + video)',
      'Slow-motion phase replay videos',
      'Metrics Generate: Google Docs reports',
      'One-click YouTube publish (Unlisted)',
      'Player database + progress tracking',
      'Recording Hub (screen + webcam + mic)',
      'Match Decoder (SwingVision import)',
      'AngleMotion Academy + coach profile',
    ],
  },
  {
    id: 'academy',
    name: 'Academy',
    tagline: 'Pro for your whole team.',
    priceMonthly: 40,
    priceYearly: 400,
    seats: 5,
    features: [
      'Everything in Pro',
      'Up to 5 coach seats',
      'One shared subscription for the academy',
      'Central billing for all coaches',
    ],
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
