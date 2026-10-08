import { PRICE_CURRENCY, type BillingCycle } from '@/lib/plans';

/** The fields of a Stripe Price the checkout guard reads. */
export interface PriceFacts {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count?: number | null } | null;
}

/**
 * Why a configured Stripe price must NOT be sold (or shown) for `cycle`, or
 * null if it is sellable. Pure, so it is unit-tested (tests/checkoutGuard.test.ts)
 * without Stripe.
 *
 * The amount is not compared to anything: the site displays the amount of this
 * very price (lib/billing/livePrices.ts), so what is shown is what is charged.
 * What can still be wrong is the price itself — archived, in another currency,
 * recurring on another interval, or without a fixed amount.
 */
export function priceMismatch(cycle: BillingCycle, price: PriceFacts): string | null {
  const expectedInterval = cycle === 'yearly' ? 'year' : 'month';
  if (!price.active) return `price ${price.id} is archived`;
  if (price.currency !== PRICE_CURRENCY.toLowerCase()) return `price ${price.id} is ${price.currency}, expected ${PRICE_CURRENCY.toLowerCase()}`;
  if (typeof price.unit_amount !== 'number' || price.unit_amount <= 0) return `price ${price.id} has no fixed amount`;
  if (price.recurring?.interval !== expectedInterval || (price.recurring?.interval_count ?? 1) !== 1) {
    return `price ${price.id} recurs every ${price.recurring?.interval_count ?? '?'} ${price.recurring?.interval ?? '?'}, expected 1 ${expectedInterval}`;
  }
  return null;
}

/** The displayable amount (in currency units) of a sellable price, else null. */
export function sellableAmount(cycle: BillingCycle, price: PriceFacts): number | null {
  return priceMismatch(cycle, price) ? null : price.unit_amount! / 100;
}
