import { planPrice, PRICE_CURRENCY, type Plan, type BillingCycle } from '@/lib/plans';

/** The fields of a Stripe Price the checkout guard reads. */
export interface PriceFacts {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count?: number | null } | null;
}

/**
 * Why a configured Stripe price must NOT be sold for (plan, cycle), or null if
 * it matches exactly what the site displays. Pure, so it is unit-tested
 * (tests/checkoutGuard.test.ts) without Stripe.
 */
export function priceMismatch(plan: Plan, cycle: BillingCycle, price: PriceFacts): string | null {
  const expectedCents = Math.round(planPrice(plan, cycle) * 100);
  const expectedInterval = cycle === 'yearly' ? 'year' : 'month';
  if (!price.active) return `price ${price.id} is archived`;
  if (price.currency !== PRICE_CURRENCY.toLowerCase()) return `price ${price.id} is ${price.currency}, expected ${PRICE_CURRENCY.toLowerCase()}`;
  if (price.unit_amount !== expectedCents) return `price ${price.id} is ${price.unit_amount}, site shows ${expectedCents}`;
  if (price.recurring?.interval !== expectedInterval || (price.recurring?.interval_count ?? 1) !== 1) {
    return `price ${price.id} recurs every ${price.recurring?.interval_count ?? '?'} ${price.recurring?.interval ?? '?'}, expected 1 ${expectedInterval}`;
  }
  return null;
}
