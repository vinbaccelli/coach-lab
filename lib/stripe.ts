import 'server-only';
import Stripe from 'stripe';
import type { PlanId, BillingCycle } from '@/lib/plans';

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' })
  : (null as unknown as Stripe);

/**
 * The six EUR launch prices — one env var per (plan, cycle), nothing else.
 * There is deliberately NO fallback: the pre-launch USD prices and the legacy
 * single-tier STRIPE_PRICE_MONTHLY/YEARLY vars are gone, so a missing var
 * means "not sold", never "sold at some other price".
 */
export const PRICE_ENV: Record<PlanId, Record<BillingCycle, string>> = {
  light: { monthly: 'STRIPE_PRICE_LIGHT_MONTHLY', yearly: 'STRIPE_PRICE_LIGHT_YEARLY' },
  pro: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', yearly: 'STRIPE_PRICE_PRO_YEARLY' },
  academy: { monthly: 'STRIPE_PRICE_ACADEMY_MONTHLY', yearly: 'STRIPE_PRICE_ACADEMY_YEARLY' },
};

/** The configured Stripe price ID for (plan, cycle), or '' when its env var is unset. */
export function priceIdFor(plan: PlanId, cycle: BillingCycle): string {
  return (process.env[PRICE_ENV[plan][cycle]] ?? '').trim();
}

/** Reverse-map a purchased Stripe price ID back to its plan (for the webhook). */
export function tierForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PRICE_ENV) as PlanId[]) {
    if (priceId === priceIdFor(plan, 'monthly') || priceId === priceIdFor(plan, 'yearly')) return plan;
  }
  return null;
}
