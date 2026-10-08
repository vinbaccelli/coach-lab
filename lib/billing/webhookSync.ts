import type Stripe from 'stripe';
import { getPlan, isValidPlanId, type PlanId } from '@/lib/plans';
import { fiscalDraftFromInvoice, isFiscalSale, type FiscalInvoiceDraft } from '@/lib/billing/invoicing/draft';

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
 *  - invoice.paid with money taken also records a fiscal_invoices row (the
 *    data the Italian fattura is issued from — docs/INVOICING.md) and copies
 *    the customer's billing country to billing_profiles. Both writes are
 *    idempotent (keyed by Stripe invoice id / user id), so a retry is safe.
 */

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string;
  stripe_price_id: string | null;
  /** Only on checkout.session.completed: the Checkout that created it. */
  stripe_checkout_session_id?: string;
  status: string;
  tier?: PlanId;
  seats?: number;
  billing_interval: 'month' | 'year' | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  updated_at: string;
};

export class RetryableError extends Error {}

export interface SyncDeps {
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  retrieveCustomer(id: string): Promise<Stripe.Customer | Stripe.DeletedCustomer>;
  tierForPriceId(priceId: string | null | undefined): PlanId | null;
  hasProcessedEvent(eventId: string): Promise<boolean>;
  recordEvent(eventId: string, type: string): Promise<void>;
  upsertSubscription(row: SubscriptionRow): Promise<void>;
  /** Patch rows by subscription id (legacy rows with no userId metadata). Returns rows matched. */
  updateBySubscriptionId(subscriptionId: string, patch: Partial<SubscriptionRow>): Promise<number>;
  /** Insert unless a row for this Stripe invoice exists (never overwrites an issued one). */
  recordFiscalInvoice(draft: FiscalInvoiceDraft): Promise<void>;
  /** Store the coach's billing country (drives the Italian invoice-details form). */
  upsertBillingCountry(userId: string, country: string): Promise<void>;
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
  'invoice.payment_action_required',
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
    stripe_price_id: item?.price?.id ?? null,
    status: sub.status,
    billing_interval: interval === 'month' || interval === 'year' ? interval : null,
    // Since API 2025-03-31 the billing period lives on the subscription item.
    current_period_start: iso((item as { current_period_start?: number } | undefined)?.current_period_start),
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

async function syncSubscription(
  subId: string,
  userIdHint: string | null,
  deps: SyncDeps,
  extra: Partial<SubscriptionRow> = {},
): Promise<{ sub: Stripe.Subscription; userId: string | null; fields: Omit<SubscriptionRow, 'user_id'> }> {
  const sub = await deps.retrieveSubscription(subId);
  const userId = userIdHint ?? sub.metadata?.userId ?? null;
  const fields = { ...subscriptionFields(sub, deps), ...extra };
  if (userId) {
    await deps.upsertSubscription({ user_id: userId, ...fields });
    return { sub, userId, fields };
  }
  const matched = await deps.updateBySubscriptionId(sub.id, fields);
  if (matched === 0) {
    // No user can be attached (no metadata, no stored row). Retrying cannot fix
    // that, so it is acknowledged — loudly.
    deps.log('[stripe/webhook] subscription with no user and no stored row:', sub.id);
  }
  return { sub, userId, fields };
}

/** invoice.paid with money taken: the fiscal record + the billing country. */
async function recordPaidInvoice(
  invoice: Stripe.Invoice,
  synced: { userId: string | null; fields: Omit<SubscriptionRow, 'user_id'> } | null,
  deps: SyncDeps,
) {
  if (!isFiscalSale(invoice)) return;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  const fetched = customerId ? await deps.retrieveCustomer(customerId) : null;
  const customer = fetched && !('deleted' in fetched && fetched.deleted) ? (fetched as Stripe.Customer) : null;
  const draft = fiscalDraftFromInvoice(invoice, customer, {
    userId: synced?.userId ?? null,
    plan: synced?.fields.tier ?? null,
    interval: synced?.fields.billing_interval ?? null,
    now: deps.now(),
  });
  await deps.recordFiscalInvoice(draft);
  if (draft.user_id && draft.customer_country) await deps.upsertBillingCountry(draft.user_id, draft.customer_country);
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
      await syncSubscription(subId, userId, deps, { stripe_checkout_session_id: session.id });
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
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required': {
      // A renewal paid, failed, or needs the customer to confirm (3-D Secure):
      // re-read the subscription so status and the period move with it (paid →
      // active and a new period; failed / action required → past_due or
      // incomplete once Stripe updates the subscription — the /billing banner
      // then sends the coach to the portal to fix it).
      const invoice = event.data.object as Stripe.Invoice;
      const subId = idOf(invoice.parent?.subscription_details?.subscription);
      const synced = subId ? await syncSubscription(subId, null, deps) : null;
      if (event.type === 'invoice.paid') await recordPaidInvoice(invoice, synced, deps);
      break;
    }
  }

  await deps.recordEvent(event.id, event.type);
  return 'processed';
}
