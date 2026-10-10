import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { stripe, priceIdFor, PRICE_ENV } from '@/lib/stripe';
import { isValidPlanId, getPlan, type BillingCycle } from '@/lib/plans';
import { priceMismatch } from '@/lib/billing/checkoutGuard';
import { checkoutTaxParams } from '@/lib/billing/taxConfig';

/**
 * Start a Stripe Checkout for one plan and cycle. FAILS CLOSED:
 *  - the plan's own env var must be set — there is no fallback price;
 *  - the Stripe price it points at must be sellable: active, in
 *    PRICE_CURRENCY, recurring every 1 month/year as the cycle says
 *    (lib/billing/checkoutGuard.ts). The site displays this same price's
 *    amount (lib/billing/livePrices.ts), so what is shown is what is charged
 *    (docs/KNOWN_ISSUES.md 007 is how a mismatch happened before).
 * Promotion codes are accepted on Pro yearly only — the Coach Life coupon is
 * restricted to that price in Stripe as well.
 */
export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { plan?: string; cycle?: string };
  const planId = body.plan;
  if (!isValidPlanId(planId)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  if (body.cycle !== 'monthly' && body.cycle !== 'yearly') {
    return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
  }
  const cycle: BillingCycle = body.cycle;
  const plan = getPlan(planId)!;

  const unavailable = (why: string) => {
    console.error(`[stripe/checkout] refusing ${planId} ${cycle}: ${why}`);
    return NextResponse.json(
      { error: `${plan.name} (${cycle}) can't be purchased right now. Please contact us — you have not been charged.` },
      { status: 503 },
    );
  };

  const priceId = priceIdFor(planId, cycle);
  if (!priceId) return unavailable(`${PRICE_ENV[planId][cycle]} is not set`);
  if (!stripe) return unavailable('STRIPE_SECRET_KEY is not set');

  try {
    const price = await stripe.prices.retrieve(priceId);
    const mismatch = priceMismatch(cycle, price);
    if (mismatch) return unavailable(mismatch);

    // One Stripe Customer per coach: reuse the ID the webhook stored on the
    // first checkout, so later checkouts and the portal share one customer
    // (and its saved name, address and tax ID). First checkout: Stripe creates
    // the Customer from the email and the details typed at checkout.
    const { data: subRow } = await session.supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', session.userId)
      .maybeSingle<{ stripe_customer_id: string | null }>();
    const existingCustomer = subRow?.stripe_customer_id ?? null;

    const origin = req.headers.get('origin') ?? 'http://localhost:3000';
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ...(existingCustomer ? { customer: existingCustomer } : { customer_email: session.email ?? undefined }),
      // Tax and customer details (name, billing address, optional business
      // name and VAT ID) — configured only in lib/billing/taxConfig.ts.
      ...checkoutTaxParams({ existingCustomer: !!existingCustomer }),
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: planId === 'pro' && cycle === 'yearly' ? true : undefined,
      success_url: `${origin}/analysis?subscribed=1`,
      cancel_url: `${origin}/pricing`,
      // The user travels on the session AND on the subscription itself, so every
      // later customer.subscription.* event can be upserted by user_id (the
      // webhook re-reads the subscription and maps its price to the plan).
      client_reference_id: session.userId,
      metadata: { userId: session.userId, plan: planId, cycle, seats: String(plan.seats) },
      subscription_data: { metadata: { userId: session.userId, plan: planId, cycle } },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    console.error('[stripe/checkout] Stripe error:', err?.message ?? err);
    return NextResponse.json({ error: 'Checkout could not start. Please try again or contact us — you have not been charged.' }, { status: 502 });
  }
}
