import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const userId = session.metadata?.userId;
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    if (userId) {
      try {
        // Webhooks carry no user session — writes need the service-role client
        // (the anon/session client is blocked by RLS here).
        const supabase = createSupabaseServiceClient();
        if (!supabase) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: 'active',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch (e) { console.error('[stripe/webhook] subscription upsert failed:', e); }
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as any;
    const status = sub.status;
    try {
      const supabase = createSupabaseServiceClient();
      if (!supabase) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
      await supabase.from('subscriptions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', sub.id);
    } catch (e) { console.error('[stripe/webhook] subscription update failed:', e); }
  }

  return NextResponse.json({ received: true });
}
