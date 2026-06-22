import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { stripe, PRICES } from '@/lib/stripe';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan } = (await req.json()) as { plan: 'monthly' | 'yearly' };
  const priceId = plan === 'yearly' ? PRICES.yearly : PRICES.monthly;

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: session.email ?? undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/analysis?subscribed=1`,
      cancel_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/pricing`,
      metadata: { userId: session.userId },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
