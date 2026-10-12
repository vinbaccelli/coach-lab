import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, tierForPriceId } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { processStripeEvent, HANDLED_EVENTS, RetryableError, type SyncDeps } from '@/lib/billing/webhookSync';
import type { DraftProductType } from '@/lib/billing/invoicing/draft';

const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;

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
    retrieveCustomer: (id) => stripe.customers.retrieve(id),
    async listCheckoutLineItems(sessionId) {
      const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 20 });
      return {
        names: items.data.map((i) => i.description ?? '').filter(Boolean),
        productIds: items.data.map((i) => idOf(i.price?.product)).filter((v): v is string => !!v),
      };
    },
    async productTypes(productIds) {
      const map = new Map<string, DraftProductType>();
      if (!productIds.length) return map;
      const { data, error } = await db.from('invoice_product_types').select('stripe_product_id, product_type').in('stripe_product_id', productIds);
      if (error) throw new RetryableError(`invoice_product_types read failed: ${error.message}`);
      for (const r of data ?? []) map.set(r.stripe_product_id as string, r.product_type as DraftProductType);
      return map;
    },
    async paymentIntentForInvoice(invoiceId) {
      const list = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 3 });
      const paid = list.data.find((p) => p.status === 'paid') ?? list.data[0];
      return paid?.payment?.type === 'payment_intent' ? idOf(paid.payment.payment_intent) : null;
    },
    async markRefunded(paymentIntentId, refundedCents, at) {
      const { data, error } = await db
        .from('fiscal_invoices')
        .update({ refunded_amount_cents: refundedCents, refunded_at: at, updated_at: new Date().toISOString() })
        .eq('stripe_payment_intent_id', paymentIntentId)
        .select('id');
      if (error) throw new RetryableError(`fiscal_invoices refund update failed for ${paymentIntentId}: ${error.message}`);
      return data?.length ?? 0;
    },
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
    async recordFiscalInvoice(draft) {
      // ignoreDuplicates: a retried event never overwrites a row Vin may
      // already have issued (number, XML). Subscriptions are keyed by Stripe
      // invoice, one-off sales by Checkout Session.
      const onConflict = draft.source === 'one_off' ? 'stripe_checkout_session_id' : 'stripe_invoice_id';
      const { error } = await db.from('fiscal_invoices').upsert(draft, { onConflict, ignoreDuplicates: true });
      if (error) throw new RetryableError(`fiscal_invoices insert failed for ${draft.stripe_checkout_session_id ?? draft.stripe_invoice_id}: ${error.message}`);
    },
    async upsertBillingCountry(userId, country) {
      const { error } = await db
        .from('billing_profiles')
        .upsert({ user_id: userId, billing_country: country, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw new RetryableError(`billing_profiles upsert failed for ${userId}: ${error.message}`);
    },
    now: () => new Date(),
    log: (...args) => console.error(...args),
  };

  // A test-mode event on a deployment with a live key (or the reverse) can't
  // be re-read from Stripe: say so plainly instead of failing obscurely.
  const keyIsLive = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live') || (process.env.STRIPE_SECRET_KEY ?? '').startsWith('rk_live');
  if (event.livemode !== keyIsLive) {
    const msg = `${event.livemode ? 'Live' : 'Test'}-mode event received by a deployment whose STRIPE_SECRET_KEY is ${keyIsLive ? 'live' : 'test'}: set the matching key (docs/STRIPE_LAUNCH_SETUP.md)`;
    await recordEventError(db, event, msg);
    console.error('[stripe/webhook]', event.id, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    const outcome = await processStripeEvent(event, deps);
    if (outcome === 'processed') {
      // Stripe's retry succeeded: close any error logged for this event.
      await db.from('billing_event_errors').update({ resolved_at: new Date().toISOString() }).eq('event_id', event.id).is('resolved_at', null);
    }
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[stripe/webhook]', event.type, event.id, 'failed — returning 500 so Stripe retries:', msg);
    await recordEventError(db, event, msg);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

/**
 * Log a failed event (shown on /admin/invoices until a retry succeeds), with
 * the attempt count. Best effort: logging must never change the answer.
 */
async function recordEventError(db: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, event: Stripe.Event, error: string) {
  try {
    const now = new Date().toISOString();
    const { data } = await db.from('billing_event_errors').select('attempts').eq('event_id', event.id).maybeSingle();
    await db.from('billing_event_errors').upsert({
      event_id: event.id, event_type: event.type, livemode: event.livemode, error: error.slice(0, 2000),
      attempts: ((data?.attempts as number | undefined) ?? 0) + 1, last_failed_at: now, resolved_at: null,
    }, { onConflict: 'event_id' });
  } catch (e) {
    console.error('[stripe/webhook] could not log the failure of', event.id, e instanceof Error ? e.message : e);
  }
}
