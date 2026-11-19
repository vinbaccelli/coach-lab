import PricingClient from './PricingClient';
import { getLivePrices } from '@/lib/billing/livePrices';
import { pageMetadata } from '@/lib/seo/site';

export const metadata = pageMetadata({
  title: 'Pricing – AngleMotion',
  description: 'Three plans for players, coaches and academies. Every tool is free for one hour first: no card, no booking.',
  path: '/pricing',
});

// Rendered per request so a Stripe hiccup is never frozen into a static page;
// the prices themselves come from the one-hour data cache (no Stripe call per
// visit). Same as `/`, which is force-dynamic for the auth check.
export const dynamic = 'force-dynamic';

/**
 * Pricing (`/pricing`). Server shell: reads the live Stripe prices (cached,
 * lib/billing/livePrices.ts) and renders the client page with them, so the
 * amounts are in the HTML and no price lives in code.
 */
export default async function PricingPage() {
  return <PricingClient prices={await getLivePrices()} />;
}
