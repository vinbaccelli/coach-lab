import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { stripe } from '@/lib/stripe';

/**
 * Open the Stripe Customer Portal for the signed-in coach — ONLY for the
 * Stripe Customer the webhook linked to their account (subscriptions row).
 * There is deliberately no lookup by email: an email match is not proof that
 * a Stripe Customer belongs to this account (docs/KNOWN_ISSUES.md 025).
 */
export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!stripe) return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 });

  const { data: subRow, error } = await session.supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', session.userId)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  if (error) return NextResponse.json({ error: 'Could not read your subscription. Please try again.' }, { status: 503 });

  const customerId = subRow?.stripe_customer_id ?? null;
  if (!customerId) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${req.headers.get('origin') ?? 'http://localhost:3000'}/billing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error('[stripe/portal] Stripe error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'The billing portal could not open. Please try again.' }, { status: 502 });
  }
}
