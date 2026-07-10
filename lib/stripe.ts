import 'server-only';
import Stripe from 'stripe';
import type { PlanId, BillingCycle } from '@/lib/plans';

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' })
  : (null as unknown as Stripe);

// Six recurring prices — 2 cycles × 3 tiers. Pro falls back to the original
// single-tier env vars (STRIPE_PRICE_MONTHLY/YEARLY) so existing Pro subscribers
// and config keep working; STRIPE_PRICE_PRO_* override them when set.
export const PRICES = {
  lightMonthly: process.env.STRIPE_PRICE_LIGHT_MONTHLY ?? '',
  lightYearly: process.env.STRIPE_PRICE_LIGHT_YEARLY ?? '',
  proMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? process.env.STRIPE_PRICE_MONTHLY ?? '',
  proYearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? process.env.STRIPE_PRICE_YEARLY ?? '',
  academyMonthly: process.env.STRIPE_PRICE_ACADEMY_MONTHLY ?? '',
  academyYearly: process.env.STRIPE_PRICE_ACADEMY_YEARLY ?? '',

  // Back-compat aliases (old callers used PRICES.monthly / PRICES.yearly = Pro).
  monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? process.env.STRIPE_PRICE_MONTHLY ?? '',
  yearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? process.env.STRIPE_PRICE_YEARLY ?? '',
} as const;

/** Resolve a (plan, cycle) to its configured Stripe price ID (or '' if unset). */
export function priceIdFor(plan: PlanId, cycle: BillingCycle): string {
  const key = `${plan}${cycle === 'yearly' ? 'Yearly' : 'Monthly'}` as keyof typeof PRICES;
  return PRICES[key] ?? '';
}

/** Reverse-map a purchased Stripe price ID back to its tier (for the webhook). */
export function tierForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === PRICES.lightMonthly || priceId === PRICES.lightYearly) return 'light';
  if (priceId === PRICES.proMonthly || priceId === PRICES.proYearly) return 'pro';
  if (priceId === PRICES.academyMonthly || priceId === PRICES.academyYearly) return 'academy';
  return null;
}
