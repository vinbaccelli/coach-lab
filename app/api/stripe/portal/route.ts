import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { stripe } from '@/lib/stripe';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Prefer the customer id stored by the webhook; fall back to email lookup.
  let customerId: string | null = null;
  const { data: subRow } = await session.supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', session.userId)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  if (subRow?.stripe_customer_id) customerId = subRow.stripe_customer_id;

  if (!customerId) {
    const customers = await stripe.customers.list({ email: session.email ?? '', limit: 1 });
    customerId = customers.data[0]?.id ?? null;
  }
  if (!customerId) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/billing`,
  });

  return NextResponse.json({ url: portal.url });
}
