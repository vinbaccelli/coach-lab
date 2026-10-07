import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, tierForPriceId } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { processStripeEvent, HANDLED_EVENTS, RetryableError, type SyncDeps } from '@/lib/billing/webhookSync';

/**
 * Stripe webhook. Signature-checked, then handed to lib/billing/webhookSync.ts
 * (the contract lives there): event-level idempotency via
 * `stripe_webhook_events`, every write checked, failures answered 500 so
 * Stripe retries, rows written from the subscription re-read from Stripe.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return NextResponse.json({ received: true });
  }

  // Webhooks carry no user session — writes need the service-role client.
  // Missing configuration is an error to retry, not a success to acknowledge.
  const db = createSupabaseServiceClient();
  if (!db) {
    console.error('[stripe/webhook] SUPABASE_SERVICE_ROLE_KEY not configured; event', event.id, 'will be retried');
    return NextResponse.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const deps: SyncDeps = {
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    tierForPriceId,
    async hasProcessedEvent(eventId) {
      const { data, error } = await db.from('stripe_webhook_events').select('event_id').eq('event_id', eventId).maybeSingle();
      if (error) throw new RetryableError(`stripe_webhook_events read failed: ${error.message}`);
      return !!data;
    },
    async recordEvent(eventId, type) {
      const { error } = await db
        .from('stripe_webhook_events')
        .upsert({ event_id: eventId, type, processed_at: new Date().toISOString() }, { onConflict: 'event_id', ignoreDuplicates: true });
      if (error) throw new RetryableError(`stripe_webhook_events write failed: ${error.message}`);
    },
    async upsertSubscription(row) {
      const { error } = await db.from('subscriptions').upsert(row, { onConflict: 'user_id' });
      if (error) throw new RetryableError(`subscriptions upsert failed for ${row.user_id}: ${error.message}`);
    },
    async updateBySubscriptionId(subscriptionId, patch) {
      const { data, error } = await db.from('subscriptions').update(patch).eq('stripe_subscription_id', subscriptionId).select('user_id');
      if (error) throw new RetryableError(`subscriptions update failed for ${subscriptionId}: ${error.message}`);
      return data?.length ?? 0;
    },
    now: () => new Date(),
    log: (...args) => console.error(...args),
  };

  try {
    const outcome = await processStripeEvent(event, deps);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error('[stripe/webhook]', event.type, event.id, 'failed — returning 500 so Stripe retries:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
