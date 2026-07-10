import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { stripe, priceIdFor } from '@/lib/stripe';
import { isValidPlanId, getPlan, type BillingCycle } from '@/lib/plans';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as { plan?: string; cycle?: string };

  // Back-compat: the old client sent { plan: 'monthly' | 'yearly' } (Pro-only).
  let planId = body.plan;
  let cycle: BillingCycle = body.cycle === 'yearly' || body.cycle === 'monthly' ? body.cycle : 'yearly';
  if (planId === 'monthly' || planId === 'yearly') {
    cycle = planId;
    planId = 'pro';
  }

  if (!isValidPlanId(planId)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const priceId = priceIdFor(planId, cycle);
  if (!priceId) {
    return NextResponse.json(
      { error: `The ${planId} ${cycle} plan is not configured yet. Add its Stripe price ID.` },
      { status: 400 },
    );
  }

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: session.email ?? undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/analysis?subscribed=1`,
      cancel_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/pricing`,
      // Tier travels through checkout so the webhook can store it even before it
      // resolves the price ID (belt-and-suspenders with tierForPriceId).
      metadata: { userId: session.userId, plan: planId, cycle, seats: String(getPlan(planId)?.seats ?? 1) },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
