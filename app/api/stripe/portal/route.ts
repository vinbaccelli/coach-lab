import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { stripe } from '@/lib/stripe';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find Stripe customer by email
  const customers = await stripe.customers.list({ email: session.email ?? '', limit: 1 });
  if (customers.data.length === 0) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: customers.data[0].id,
    return_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/`,
  });

  return NextResponse.json({ url: portal.url });
}
