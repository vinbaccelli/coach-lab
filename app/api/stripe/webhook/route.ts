import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe, tierForPriceId } from '@/lib/stripe';
import { getPlan, isValidPlanId, type PlanId } from '@/lib/plans';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

/**
 * Stripe → `subscriptions` sync.
 *
 * Contract (docs/PRICING_PLANS_PROPOSAL.md B3):
 *  - A failed write is NEVER acknowledged. supabase-js returns `{ error }`
 *    rather than throwing, so every write is checked; on failure the handler
 *    logs and answers 500, and Stripe retries the event (with backoff, for up
 *    to three days). Writes are upserts keyed on `user_id`, so a retry is
 *    idempotent.
 *  - The row always reflects the subscription's CURRENT state, re-read from
 *    Stripe, never the event payload: events can arrive out of order, and a
 *    late `customer.subscription.created` (status `incomplete`) must not
 *    overwrite a newer `active`.
 *  - The tier comes from the price the subscription is actually on. Metadata
 *    is a fallback only; if neither resolves, the event fails (500) instead
 *    of silently granting a default tier.
 *  - The status is Stripe's own (`active`, `trialing`, `incomplete`,
 *    `past_due`, `canceled`…), never a hard-coded `active`. A SEPA checkout
 *    completes with the payment still pending; the subscription stays
 *    `incomplete` until it clears, and access follows that.
 */

type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string;
  status: string;
  tier?: PlanId;
  seats?: number;
  updated_at: string;
};

class RetryableError extends Error {}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

/** The tier a subscription is on: its price first, its metadata second. */
function resolveTier(sub: Stripe.Subscription): PlanId | null {
  const fromPrice = tierForPriceId(sub.items?.data?.[0]?.price?.id);
  if (fromPrice) return fromPrice;
  const meta = sub.metadata?.plan;
  return isValidPlanId(meta) ? meta : null;
}

function rowFor(userId: string, sub: Stripe.Subscription): SubscriptionRow {
  const row: SubscriptionRow = {
    user_id: userId,
    stripe_customer_id: idOf(sub.customer as string | { id: string } | null),
    stripe_subscription_id: sub.id,
    status: sub.status,
    updated_at: new Date().toISOString(),
  };
  const tier = resolveTier(sub);
  if (tier) {
    row.tier = tier;
    row.seats = getPlan(tier)?.seats ?? 1;
  } else if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
    // A live subscription on a price we cannot map is a configuration error
    // (env var missing or pointing elsewhere). Fail so it is retried once the
    // env is fixed, instead of storing a guessed tier.
    throw new RetryableError(`no tier for price ${sub.items?.data?.[0]?.price?.id ?? '(none)'} on ${sub.id}`);
  }
  return row;
}

async function upsertRow(db: SupabaseClient, row: SubscriptionRow) {
  const { error } = await db.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  if (error) throw new RetryableError(`subscriptions upsert failed for ${row.user_id}: ${error.message}`);
}

/**
 * Rows written before subscriptions carried `metadata.userId` can only be
 * found by subscription id. Zero matched rows is reported, not ignored.
 */
async function updateBySubscriptionId(db: SupabaseClient, sub: Stripe.Subscription) {
  const patch: Record<string, unknown> = { status: sub.status, updated_at: new Date().toISOString() };
  const tier = resolveTier(sub);
  if (tier) { patch.tier = tier; patch.seats = getPlan(tier)?.seats ?? 1; }
  const { data, error } = await db.from('subscriptions').update(patch).eq('stripe_subscription_id', sub.id).select('user_id');
  if (error) throw new RetryableError(`subscriptions update failed for ${sub.id}: ${error.message}`);
  if (!data || data.length === 0) {
    // No user can be attached to this subscription (no metadata, no stored
    // row). Retrying cannot fix that, so it is acknowledged — loudly.
    console.error('[stripe/webhook] subscription with no user and no stored row:', sub.id);
  }
}

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

  const relevant =
    event.type === 'checkout.session.completed' ||
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted';
  if (!relevant) return NextResponse.json({ received: true });

  // Webhooks carry no user session — writes need the service-role client.
  // Missing configuration is an error to retry, not a success to acknowledge.
  const db = createSupabaseServiceClient();
  if (!db) {
    console.error('[stripe/webhook] SUPABASE_SERVICE_ROLE_KEY not configured; event', event.id, 'will be retried');
    return NextResponse.json({ error: 'Service client not configured' }, { status: 500 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = idOf(session.subscription as string | { id: string } | null);
      if (session.mode !== 'subscription' || !subId) return NextResponse.json({ received: true });
      const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
      if (!userId) {
        console.error('[stripe/webhook] checkout session without a user:', session.id);
        return NextResponse.json({ received: true });
      }
      const sub = await stripe.subscriptions.retrieve(subId);
      await upsertRow(db, rowFor(userId, sub));
    } else {
      const eventSub = event.data.object as Stripe.Subscription;
      // Re-read: the payload may be older than what Stripe holds now. A deleted
      // subscription is still retrievable, with status `canceled`.
      const sub = await stripe.subscriptions.retrieve(eventSub.id);
      const userId = sub.metadata?.userId;
      if (userId) await upsertRow(db, rowFor(userId, sub));
      else await updateBySubscriptionId(db, sub);
    }
  } catch (e) {
    console.error('[stripe/webhook]', event.type, event.id, 'failed — returning 500 so Stripe retries:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
