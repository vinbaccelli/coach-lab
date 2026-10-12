import 'server-only';
import { unstable_cache } from 'next/cache';
import { stripe, priceIdFor } from '@/lib/stripe';
import { NO_PRICES, PLANS, type BillingCycle, type PlanPrices } from '@/lib/plans';
import { sellableAmount } from '@/lib/billing/checkoutGuard';

/**
 * The amounts the site displays, read from the Stripe Prices the six
 * STRIPE_PRICE_* env vars point at. Stripe is the source of truth for prices;
 * lib/plans.ts holds none.
 *
 * Live query contract (CLAUDE.md §6, approved by Vin 2026-10-07 as "D2"):
 *  - At most six stripe.prices.retrieve calls per cache fill, then cached for
 *    PRICE_CACHE_SECONDS in Next's data cache (shared across requests and
 *    instances). Page renders never wait on Stripe while the cache is warm.
 *  - The cache key contains the six configured price IDs, so pointing an env
 *    var at a new Price (+ redeploy) is a cache miss: the new amount shows
 *    immediately, never an hour-old one beside a checkout charging the new one.
 *  - A Stripe error is NOT cached: the fill throws, this returns NO_PRICES
 *    ("—" on the page) and the next request tries again.
 *  - A missing env var or an unsellable price (archived, other currency or
 *    interval) is a null for that plan/cycle — the same rule checkout enforces.
 */
export const PRICE_CACHE_SECONDS = 3600;

async function fetchPrices(ids: Array<[string, BillingCycle, string]>): Promise<PlanPrices> {
  const out: PlanPrices = structuredClone(NO_PRICES);
  await Promise.all(
    ids.map(async ([plan, cycle, priceId]) => {
      if (!priceId) return;
      const price = await stripe.prices.retrieve(priceId); // throws → not cached
      out[plan as keyof PlanPrices][cycle] = sellableAmount(cycle, price);
    }),
  );
  return out;
}

export async function getLivePrices(): Promise<PlanPrices> {
  if (!stripe) return NO_PRICES;
  const ids: Array<[string, BillingCycle, string]> = PLANS.flatMap((p) =>
    (['monthly', 'yearly'] as const).map((c) => [p.id, c, priceIdFor(p.id, c)] as [string, BillingCycle, string]),
  );
  const cached = unstable_cache(() => fetchPrices(ids), ['stripe-live-prices', ...ids.map(([, , id]) => id || '-')], {
    revalidate: PRICE_CACHE_SECONDS,
    tags: ['stripe-live-prices'],
  });
  try {
    return await cached();
  } catch (e) {
    console.error('[livePrices] Stripe price read failed; showing no prices this request:', e instanceof Error ? e.message : e);
    return NO_PRICES;
  }
}
