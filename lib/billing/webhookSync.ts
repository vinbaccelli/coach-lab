import type Stripe from 'stripe';
import { getPlan, isValidPlanId, type PlanId } from '@/lib/plans';

/**
 * Stripe → `subscriptions` sync, independent of Next and Supabase so it can be
 * unit-tested (tests/webhookSync.test.ts). app/api/stripe/webhook/route.ts
 * wires it to the real Stripe client and the service-role Supabase client.
 *
 * Contract (docs/PRICING_PLANS_PROPOSAL.md B3 + R1g):
 *  - Event-level idempotency: an event id already in `stripe_webhook_events`
 *    is acknowledged without doing anything. The id is recorded only AFTER the
 *    work succeeds, so a failed run is retried by Stripe and re-done.
 *  - A failed write is never acknowledged: it throws RetryableError → 500.
 *  - The row always reflects the subscription as Stripe holds it NOW (re-read),
 *    never the event payload — events arrive out of order. Stripe stays the
 *    source of truth; the row is a cache of it.
 *  - Plan from the subscription's price, metadata as fallback, never a default.
 */

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string;
  status: string;
  tier?: PlanId;
  seats?: number;
  billing_interval: 'month' | 'year' | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  updated_at: string;
};

export class RetryableError extends Error {}

export interface SyncDeps {
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  tierForPriceId(priceId: string | null | undefined): PlanId | null;
  hasProcessedEvent(eventId: string): Promise<boolean>;
  recordEvent(eventId: string, type: string): Promise<void>;
  upsertSubscription(row: SubscriptionRow): Promise<void>;
  /** Patch rows by subscription id (legacy rows with no userId metadata). Returns rows matched. */
  updateBySubscriptionId(subscriptionId: string, patch: Partial<SubscriptionRow>): Promise<number>;
  now(): Date;
  log(...args: unknown[]): void;
}

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

function idOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
}

const iso = (unixSeconds: number | null | undefined) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

function resolveTier(sub: Stripe.Subscription, deps: SyncDeps): PlanId | null {
  const fromPrice = deps.tierForPriceId(sub.items?.data?.[0]?.price?.id);
  if (fromPrice) return fromPrice;
  const meta = sub.metadata?.plan;
  return isValidPlanId(meta) ? meta : null;
}

/** The cached fields, re-derived from the live subscription. */
export function subscriptionFields(sub: Stripe.Subscription, deps: SyncDeps): Omit<SubscriptionRow, 'user_id'> {
  const item = sub.items?.data?.[0];
  const interval = item?.price?.recurring?.interval;
  const fields: Omit<SubscriptionRow, 'user_id'> = {
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    status: sub.status,
    billing_interval: interval === 'month' || interval === 'year' ? interval : null,
    // Since API 2025-03-31 the billing period lives on the subscription item.
    current_period_end: iso((item as { current_period_end?: number } | undefined)?.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: iso(sub.canceled_at),
    updated_at: deps.now().toISOString(),
  };
  const tier = resolveTier(sub, deps);
  if (tier) {
    fields.tier = tier;
    fields.seats = getPlan(tier)?.seats ?? 1;
  } else if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
    // A live subscription on a price we cannot map is a configuration error
    // (env var missing or pointing elsewhere): retry once it is fixed rather
    // than store a guessed plan.
    throw new RetryableError(`no plan for price ${item?.price?.id ?? '(none)'} on ${sub.id}`);
  }
  return fields;
}

async function syncSubscription(subId: string, userIdHint: string | null, deps: SyncDeps) {
  const sub = await deps.retrieveSubscription(subId);
  const userId = userIdHint ?? sub.metadata?.userId ?? null;
  const fields = subscriptionFields(sub, deps);
  if (userId) {
    await deps.upsertSubscription({ user_id: userId, ...fields });
    return;
  }
  const matched = await deps.updateBySubscriptionId(sub.id, fields);
  if (matched === 0) {
    // No user can be attached (no metadata, no stored row). Retrying cannot fix
    // that, so it is acknowledged — loudly.
    deps.log('[stripe/webhook] subscription with no user and no stored row:', sub.id);
  }
}

/**
 * Process one verified Stripe event. Returns 'duplicate' | 'ignored' | 'processed'.
 * Throws RetryableError (or any error) when the caller must answer 500.
 */
export async function processStripeEvent(event: Stripe.Event, deps: SyncDeps): Promise<'duplicate' | 'ignored' | 'processed'> {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return 'ignored';
  if (await deps.hasProcessedEvent(event.id)) return 'duplicate';

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = idOf(session.subscription);
      if (session.mode !== 'subscription' || !subId) break;
      const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
      if (!userId) {
        deps.log('[stripe/webhook] checkout session without a user:', session.id);
        break;
      }
      await syncSubscription(subId, userId, deps);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // past_due / unpaid / canceled all arrive here as status changes.
      await syncSubscription((event.data.object as Stripe.Subscription).id, null, deps);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // A renewal paid or failed: re-read the subscription so status and the
      // period end move with it (paid → active and a new period_end; failed →
      // past_due once Stripe updates the subscription).
      const invoice = event.data.object as Stripe.Invoice;
      const subId = idOf(invoice.parent?.subscription_details?.subscription);
      if (subId) await syncSubscription(subId, null, deps);
      break;
    }
  }

  await deps.recordEvent(event.id, event.type);
  return 'processed';
}
