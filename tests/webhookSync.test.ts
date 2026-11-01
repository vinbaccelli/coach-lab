import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type Stripe from 'stripe';
import { processStripeEvent, RetryableError, type SyncDeps, type SubscriptionRow } from '@/lib/billing/webhookSync';
import type { DraftProductType, FiscalInvoiceDraft } from '@/lib/billing/invoicing/draft';

const NOW = new Date('2026-10-05T12:00:00Z');
const PERIOD_START = Math.floor(Date.parse('2026-10-05T12:00:00Z') / 1000);
const PERIOD_END = Math.floor(Date.parse('2027-10-05T12:00:00Z') / 1000);

function sub(over: Partial<Stripe.Subscription> & { price?: string; interval?: 'month' | 'year' } = {}): Stripe.Subscription {
  const { price = 'price_pro_y', interval = 'year', ...rest } = over;
  return {
    id: 'sub_1', object: 'subscription', status: 'active', customer: 'cus_1',
    metadata: { userId: 'user_1', plan: 'pro' }, cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ price: { id: price, recurring: { interval } }, current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}
const ev = (type: string, object: unknown, id = 'evt_1', extra: Record<string, unknown> = {}) => ({ id, type, data: { object }, ...extra }) as unknown as Stripe.Event;

function harness(opts: {
  subscription?: Stripe.Subscription; processed?: string[]; failUpsert?: boolean; matched?: number; customer?: Partial<Stripe.Customer>;
  mapping?: Record<string, DraftProductType>; refundMatched?: number;
} = {}) {
  const calls = {
    fiscal: [] as FiscalInvoiceDraft[], countries: [] as Array<[string, string]>, upserts: [] as SubscriptionRow[],
    updates: [] as Array<[string, Partial<SubscriptionRow>]>, recorded: [] as string[], retrieved: [] as string[], logs: [] as unknown[][],
    refunds: [] as Array<[string, number, string]>,
  };
  const processed = new Set(opts.processed ?? []);
  const deps: SyncDeps = {
    async retrieveSubscription(id) { calls.retrieved.push(id); return opts.subscription ?? sub(); },
    async listCheckoutLineItems() { return { names: ['Spin Mechanics ebook'], productIds: ['prod_ebook'] }; },
    async productTypes(ids) { return new Map(ids.filter((id) => opts.mapping?.[id]).map((id) => [id, opts.mapping![id]])); },
    async paymentIntentForInvoice() { return 'pi_sub'; },
    async markRefunded(pi, cents, at) { calls.refunds.push([pi, cents, at]); return opts.refundMatched ?? 1; },
    async retrieveCustomer(id) { return { id, object: 'customer', name: 'Mario Rossi', email: 'mario@example.it', address: null, ...opts.customer } as Stripe.Customer; },
    async recordFiscalInvoice(d) { calls.fiscal.push(d); },
    async upsertBillingCountry(u, c) { calls.countries.push([u, c]); },
    tierForPriceId: (p) => (p === 'price_pro_y' || p === 'price_pro_m' ? 'pro' : p === 'price_acad_y' ? 'academy' : p === 'price_light_m' ? 'light' : null),
    async hasProcessedEvent(id) { return processed.has(id); },
    async recordEvent(id) { calls.recorded.push(id); processed.add(id); },
    async upsertSubscription(row) { if (opts.failUpsert) throw new RetryableError('db down'); calls.upserts.push(row); },
    async updateBySubscriptionId(id, patch) { calls.updates.push([id, patch]); return opts.matched ?? 1; },
    now: () => NOW,
    log: (...a) => { calls.logs.push(a); },
  };
  return { deps, calls };
}

test('checkout.session.completed writes the re-read subscription with every cached field', async () => {
  const { deps, calls } = harness();
  const out = await processStripeEvent(ev('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' }), deps);
  assert.equal(out, 'processed');
  assert.deepEqual(calls.retrieved, ['sub_1']);
  assert.deepEqual(calls.upserts[0], {
    user_id: 'user_1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_price_id: 'price_pro_y',
    stripe_checkout_session_id: 'cs_1', status: 'active', tier: 'pro', seats: 1, billing_interval: 'year',
    current_period_start: '2026-10-05T12:00:00.000Z', current_period_end: '2027-10-05T12:00:00.000Z',
    cancel_at_period_end: false, canceled_at: null, updated_at: NOW.toISOString(),
  });
  assert.deepEqual(calls.recorded, ['evt_1']);
});

test('duplicate event id: acknowledged, nothing re-done', async () => {
  const { deps, calls } = harness({ processed: ['evt_1'] });
  const out = await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps);
  assert.equal(out, 'duplicate');
  assert.equal(calls.retrieved.length + calls.upserts.length + calls.recorded.length, 0);
});

test('failed write: throws and the event id is NOT recorded, so a retry re-does it', async () => {
  const { deps, calls } = harness({ failUpsert: true });
  await assert.rejects(processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps), RetryableError);
  assert.deepEqual(calls.recorded, []);
  const retry = harness();
  assert.equal(await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), retry.deps), 'processed');
});

test('invoice.paid and invoice.payment_failed re-sync their subscription', async () => {
  for (const type of ['invoice.paid', 'invoice.payment_failed']) {
    const status = type === 'invoice.paid' ? 'active' : 'past_due';
    const { deps, calls } = harness({ subscription: sub({ status } as Partial<Stripe.Subscription>) });
    const out = await processStripeEvent(ev(type, { id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } }, 'evt_' + type), deps);
    assert.equal(out, 'processed');
    assert.equal(calls.upserts[0].status, status);
    assert.equal(calls.upserts[0].current_period_end, '2027-10-05T12:00:00.000Z');
  }
});

test('an invoice with no subscription is recorded and does nothing else', async () => {
  const { deps, calls } = harness();
  assert.equal(await processStripeEvent(ev('invoice.paid', { id: 'in_2', parent: null }), deps), 'processed');
  assert.equal(calls.retrieved.length, 0);
  assert.deepEqual(calls.recorded, ['evt_1']);
});

test('statuses pass through untouched: past_due, unpaid, canceled + cancel_at_period_end', async () => {
  for (const status of ['past_due', 'unpaid', 'incomplete', 'trialing'] as const) {
    const { deps, calls } = harness({ subscription: sub({ status } as Partial<Stripe.Subscription>) });
    await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps);
    assert.equal(calls.upserts[0].status, status);
  }
  const canceledAt = Math.floor(NOW.getTime() / 1000);
  const { deps, calls } = harness({ subscription: sub({ status: 'canceled', canceled_at: canceledAt, cancel_at_period_end: true } as Partial<Stripe.Subscription>) });
  await processStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' }), deps);
  assert.equal(calls.upserts[0].status, 'canceled');
  assert.equal(calls.upserts[0].canceled_at, NOW.toISOString());
  assert.equal(calls.upserts[0].cancel_at_period_end, true);
});

test('unmappable price on a live subscription is retried, never defaulted to pro', async () => {
  const { deps, calls } = harness({ subscription: sub({ price: 'price_unknown', metadata: { userId: 'user_1' } } as Partial<Stripe.Subscription> & { price: string }) });
  await assert.rejects(processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps), RetryableError);
  assert.equal(calls.upserts.length, 0);
});

test('Academy plan carries 4 seats; legacy row without userId is updated by subscription id', async () => {
  const { deps, calls } = harness({ subscription: sub({ price: 'price_acad_y', metadata: {} } as Partial<Stripe.Subscription> & { price: string }) });
  await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps);
  assert.equal(calls.upserts.length, 0);
  assert.equal(calls.updates[0][0], 'sub_1');
  assert.equal(calls.updates[0][1].tier, 'academy');
  assert.equal(calls.updates[0][1].seats, 4);
});

test('unhandled event types are ignored without touching the event log', async () => {
  const { deps, calls } = harness();
  assert.equal(await processStripeEvent(ev('customer.created', {}), deps), 'ignored');
  assert.equal(calls.recorded.length, 0);
});

const paidInvoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_9', number: 'ABCD-0001', customer: 'cus_1', amount_paid: 29900, currency: 'eur',
  customer_name: 'Mario Rossi', customer_email: 'mario@example.it',
  customer_address: { line1: 'Via Roma 1', line2: null, postal_code: '20100', city: 'Milano', state: 'MI', country: 'IT' },
  customer_tax_ids: [], status_transitions: { paid_at: PERIOD_START },
  lines: { data: [{ period: { start: PERIOD_START, end: PERIOD_END } }] },
  parent: { subscription_details: { subscription: 'sub_1' } },
  ...over,
});

test('invoice.paid with money taken records the fiscal invoice snapshot and the billing country', async () => {
  const { deps, calls } = harness();
  assert.equal(await processStripeEvent(ev('invoice.paid', paidInvoice()), deps), 'processed');
  assert.equal(calls.upserts[0].status, 'active');
  assert.equal(calls.fiscal.length, 1);
  const f = calls.fiscal[0];
  assert.equal(f.user_id, 'user_1');
  assert.equal(f.stripe_invoice_id, 'in_9');
  assert.equal(f.stripe_subscription_id, 'sub_1');
  assert.equal(f.amount_cents, 29900);
  assert.equal(f.currency, 'EUR');
  assert.equal(f.plan, 'pro');
  assert.equal(f.billing_interval, 'year');
  assert.equal(f.paid_at, '2026-10-05T12:00:00.000Z');
  assert.equal(f.period_end, '2027-10-05T12:00:00.000Z');
  assert.equal(f.customer_region, 'IT');
  assert.equal(f.is_business, false);
  assert.deepEqual(calls.countries, [['user_1', 'IT']]);
});

test('business customer: VAT ID and business name are captured; EU and non-EU regions', async () => {
  const { deps, calls } = harness({ customer: { business_name: 'Tennis GmbH' } as Partial<Stripe.Customer> });
  await processStripeEvent(ev('invoice.paid', paidInvoice({
    customer_address: { country: 'DE', city: 'Berlin', line1: 'X 1', line2: null, postal_code: '10115', state: null },
    customer_tax_ids: [{ type: 'eu_vat', value: 'DE123456789' }],
  })), deps);
  assert.equal(calls.fiscal[0].customer_region, 'EU');
  assert.equal(calls.fiscal[0].is_business, true);
  assert.equal(calls.fiscal[0].vat_id, 'DE123456789');
  assert.equal(calls.fiscal[0].business_name, 'Tennis GmbH');
  const us = harness();
  await processStripeEvent(ev('invoice.paid', paidInvoice({ customer_address: { country: 'US' } })), us.deps);
  assert.equal(us.calls.fiscal[0].customer_region, 'NON_EU');
});

test('no fiscal invoice for €0 invoices, failed payments or action-required', async () => {
  const zero = harness();
  await processStripeEvent(ev('invoice.paid', paidInvoice({ amount_paid: 0 })), zero.deps);
  assert.equal(zero.calls.fiscal.length, 0);
  for (const type of ['invoice.payment_failed', 'invoice.payment_action_required']) {
    const { deps, calls } = harness({ subscription: sub({ status: 'past_due' } as Partial<Stripe.Subscription>) });
    assert.equal(await processStripeEvent(ev(type, paidInvoice(), 'evt_' + type), deps), 'processed');
    assert.equal(calls.upserts[0].status, 'past_due');
    assert.equal(calls.fiscal.length, 0);
  }
});

const oneOff = (over: Record<string, unknown> = {}) => ({
  id: 'cs_one', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 3000, currency: 'eur',
  client_reference_id: null, metadata: {}, customer: null, invoice: null, payment_intent: 'pi_1',
  customer_details: { name: 'Jon Moore', email: 'jon@example.com', business_name: null, tax_ids: [],
    address: { line1: '4 Harriet Dr', line2: null, city: 'Woonona', postal_code: '2517', state: 'NSW', country: 'AU' } },
  ...over,
});

test('one-off payment-link sale (D10): recorded as one_off with what was bought; no subscription touched', async () => {
  const { deps, calls } = harness();
  assert.equal(await processStripeEvent(ev('checkout.session.completed', oneOff()), deps), 'processed');
  assert.equal(calls.retrieved.length, 0);
  assert.equal(calls.upserts.length, 0);
  const f = calls.fiscal[0];
  assert.equal(f.source, 'one_off');
  assert.equal(f.stripe_checkout_session_id, 'cs_one');
  assert.equal(f.stripe_invoice_id, null);
  assert.equal(f.stripe_payment_intent_id, 'pi_1');
  assert.equal(f.product_description, 'Spin Mechanics ebook');
  assert.equal(f.amount_cents, 3000);
  assert.equal(f.customer_category, 'NON_EU_B2C');
});

test('one-off: an unpaid async checkout waits for async_payment_succeeded; €0 is not a sale', async () => {
  const pending = harness();
  await processStripeEvent(ev('checkout.session.completed', oneOff({ payment_status: 'unpaid' })), pending.deps);
  assert.equal(pending.calls.fiscal.length, 0);
  const later = harness();
  await processStripeEvent(ev('checkout.session.async_payment_succeeded', oneOff(), 'evt_async'), later.deps);
  assert.equal(later.calls.fiscal.length, 1);
  const free = harness();
  await processStripeEvent(ev('checkout.session.completed', oneOff({ amount_total: 0 })), free.deps);
  assert.equal(free.calls.fiscal.length, 0);
});

test('B2B needs a tax ID: a company name alone stays B2C', async () => {
  const { deps, calls } = harness();
  await processStripeEvent(ev('checkout.session.completed', oneOff({
    customer_details: { name: 'X', email: 'x@y.de', business_name: 'Tennis GmbH', tax_ids: [], address: { country: 'DE', line1: 'a', city: 'b' } },
  })), deps);
  assert.equal(calls.fiscal[0].customer_category, 'EU_B2C');
  assert.equal(calls.fiscal[0].business_name, 'Tennis GmbH');
});

test('a non-subscription invoice.paid (payment-link invoice) is not recorded twice', async () => {
  const { deps, calls } = harness();
  await processStripeEvent(ev('invoice.paid', paidInvoice({ parent: null })), deps);
  assert.equal(calls.fiscal.length, 0);
});

test('subscription sale: software product type, live/test flag, PaymentIntent looked up for refunds', async () => {
  const { deps, calls } = harness();
  await processStripeEvent(ev('invoice.paid', paidInvoice({ livemode: true })), deps);
  assert.equal(calls.fiscal[0].product_type, 'software_subscription');
  assert.equal(calls.fiscal[0].livemode, true);
  assert.equal(calls.fiscal[0].stripe_payment_intent_id, 'pi_sub');
  const test = harness();
  await processStripeEvent(ev('invoice.paid', paidInvoice({ livemode: false })), test.deps);
  assert.equal(test.calls.fiscal[0].livemode, false);
});

test('one-off product type comes ONLY from the remembered mapping — never guessed', async () => {
  const unknown = harness();
  await processStripeEvent(ev('checkout.session.completed', oneOff()), unknown.deps);
  assert.equal(unknown.calls.fiscal[0].product_type, null);
  assert.deepEqual(unknown.calls.fiscal[0].stripe_product_ids, ['prod_ebook']);
  const known = harness({ mapping: { prod_ebook: 'digital_product' } });
  await processStripeEvent(ev('checkout.session.completed', oneOff({ livemode: false })), known.deps);
  assert.equal(known.calls.fiscal[0].product_type, 'digital_product');
  assert.equal(known.calls.fiscal[0].livemode, false);
});

test('charge.refunded records the refunded total on the sale by PaymentIntent', async () => {
  const { deps, calls } = harness();
  const created = Math.floor(Date.parse('2026-10-06T09:00:00Z') / 1000);
  assert.equal(await processStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 3000 }, 'evt_r', { created }), deps), 'processed');
  assert.deepEqual(calls.refunds, [['pi_1', 3000, '2026-10-06T09:00:00.000Z']]);
  assert.deepEqual(calls.recorded, ['evt_r']);
  const orphan = harness({ refundMatched: 0 });
  await processStripeEvent(ev('charge.refunded', { id: 'ch_2', payment_intent: 'pi_x', amount_refunded: 100 }), orphan.deps);
  assert.equal(orphan.calls.logs.length, 1);
});

test('a retried event after success creates no second record (event-level idempotency)', async () => {
  const { deps, calls } = harness();
  await processStripeEvent(ev('checkout.session.completed', oneOff(), 'evt_same'), deps);
  assert.equal(await processStripeEvent(ev('checkout.session.completed', oneOff(), 'evt_same'), deps), 'duplicate');
  assert.equal(calls.fiscal.length, 1);
});

// ── fix/stripe-webhook-safety (KNOWN_ISSUES 078) ─────────────────────────────

test('renewal: invoice.paid on a new period writes status active and the new period, plan unchanged', async () => {
  const nextStart = PERIOD_END;
  const nextEnd = Math.floor(Date.parse('2028-10-05T12:00:00Z') / 1000);
  const renewed = sub({
    items: { data: [{ price: { id: 'price_pro_y', recurring: { interval: 'year' } }, current_period_start: nextStart, current_period_end: nextEnd }] },
  } as unknown as Partial<Stripe.Subscription>);
  const { deps, calls } = harness({ subscription: renewed });
  const out = await processStripeEvent(ev('invoice.paid', paidInvoice(), 'evt_renew'), deps);
  assert.equal(out, 'processed');
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].status, 'active');
  assert.equal(calls.upserts[0].tier, 'pro');
  assert.equal(calls.upserts[0].current_period_start, '2027-10-05T12:00:00.000Z');
  assert.equal(calls.upserts[0].current_period_end, '2028-10-05T12:00:00.000Z');
  assert.equal(calls.fiscal.length, 1);
  assert.deepEqual(calls.recorded, ['evt_renew']);
});

test('cancellation: customer.subscription.deleted writes canceled from Stripe; the plan stays what was bought', async () => {
  const canceledAt = Math.floor(NOW.getTime() / 1000);
  const { deps, calls } = harness({ subscription: sub({ status: 'canceled', canceled_at: canceledAt } as Partial<Stripe.Subscription>) });
  // The payload says active; the row follows the subscription re-read from Stripe.
  await processStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1', status: 'active' }), deps);
  assert.equal(calls.upserts[0].status, 'canceled');
  assert.equal(calls.upserts[0].tier, 'pro');
  assert.equal(calls.upserts[0].canceled_at, NOW.toISOString());
});

test('unknown price on a live subscription: nothing written (the coach keeps the current plan), never Pro, logged by the 500', async () => {
  const { deps, calls } = harness({ subscription: sub({ price: 'price_unknown', metadata: { userId: 'user_1' } } as Partial<Stripe.Subscription> & { price: string }) });
  await assert.rejects(processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps), /no plan for price price_unknown on sub_1/);
  assert.equal(calls.upserts.length + calls.updates.length + calls.recorded.length, 0);
});

test('unknown price, checkout metadata names the plan: that plan (not a default), and it is logged', async () => {
  const { deps, calls } = harness({ subscription: sub({ price: 'price_unknown', metadata: { userId: 'user_1', plan: 'light' } } as Partial<Stripe.Subscription> & { price: string }) });
  await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), deps);
  assert.equal(calls.upserts[0].tier, 'light');
  assert.equal(calls.logs.length, 1);
  assert.match(String(calls.logs[0][0]), /price not in the plan table/);
  const bad = harness({ subscription: sub({ price: 'price_unknown', metadata: { userId: 'user_1', plan: 'enterprise' } } as Partial<Stripe.Subscription> & { price: string }) });
  await assert.rejects(processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), bad.deps), RetryableError);
  assert.equal(bad.calls.upserts.length, 0, 'an invalid metadata plan is not a plan');
});

test('unknown price on an ended subscription: the status is written, the stored plan is not touched, logged', async () => {
  const { deps, calls } = harness({ subscription: sub({ status: 'canceled', price: 'price_unknown', metadata: { userId: 'user_1' } } as Partial<Stripe.Subscription> & { price: string }) });
  await processStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' }), deps);
  assert.equal(calls.upserts[0].status, 'canceled');
  assert.equal('tier' in calls.upserts[0], false);
  assert.equal('seats' in calls.upserts[0], false);
  assert.match(String(calls.logs[0][0]), /plan left unchanged/);
});

test('same subscription event twice: written once, the second delivery is a no-op', async () => {
  const { deps, calls } = harness();
  const e = ev('customer.subscription.updated', { id: 'sub_1' }, 'evt_twice');
  assert.equal(await processStripeEvent(e, deps), 'processed');
  assert.equal(await processStripeEvent(e, deps), 'duplicate');
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.retrieved.length, 1);
  assert.deepEqual(calls.recorded, ['evt_twice']);
});

test('price → plan table through the webhook: the six launch prices, unchanged', async () => {
  const { tierForPriceId } = await import('@/lib/stripe');
  const table: Array<[string, 'light' | 'pro' | 'academy', number]> = [
    ['STRIPE_PRICE_LIGHT_MONTHLY', 'light', 1], ['STRIPE_PRICE_LIGHT_YEARLY', 'light', 1],
    ['STRIPE_PRICE_PRO_MONTHLY', 'pro', 1], ['STRIPE_PRICE_PRO_YEARLY', 'pro', 1],
    ['STRIPE_PRICE_ACADEMY_MONTHLY', 'academy', 4], ['STRIPE_PRICE_ACADEMY_YEARLY', 'academy', 4],
  ];
  const saved = Object.fromEntries(table.map(([k]) => [k, process.env[k]]));
  try {
    for (const [k] of table) process.env[k] = `price_${k.toLowerCase()}`;
    for (const [k, tier, seats] of table) {
      const { deps, calls } = harness({ subscription: sub({ price: `price_${k.toLowerCase()}`, metadata: { userId: 'user_1' } } as Partial<Stripe.Subscription> & { price: string }) });
      deps.tierForPriceId = tierForPriceId;
      await processStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }, 'evt_' + k), deps);
      assert.equal(calls.upserts[0].tier, tier, k);
      assert.equal(calls.upserts[0].seats, seats, k);
      assert.equal(calls.logs.length, 0, k);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('Sentry report of a failed webhook: event type and id, no personal data', async () => {
  const { webhookFailureReport } = await import('@/lib/billing/webhookReport');
  const r = webhookFailureReport(
    { id: 'evt_9', type: 'invoice.paid', livemode: true }, 'sync',
    'subscriptions upsert failed for 3f2b8c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f: duplicate key, Key (user_id)=(3f2b8c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f) mario@example.it cus_Q1w2E3',
  );
  assert.deepEqual(r.tags, { area: 'stripe_webhook', stage: 'sync', event_type: 'invoice.paid', event_id: 'evt_9', livemode: 'true' });
  assert.match(r.message, /invoice\.paid failed \(sync\)/);
  for (const leak of ['3f2b8c1e', 'mario', 'example.it', 'Q1w2E3']) assert.equal(r.message.includes(leak), false, leak);
  assert.match(r.message, /\[id\].*\(user_id\)=\(\[removed\]\).*\[email\].*cus_\[id\]/);
});

test('wiring: every 500 of the webhook is reported to Sentry; the report never changes the answer', () => {
  const route = readFileSync('app/api/stripe/webhook/route.ts', 'utf8');
  const posts = route.slice(route.indexOf('export async function POST'), route.indexOf('async function reportFailure'));
  assert.equal((posts.match(/status: 500/g) ?? []).length, 3, 'no service client, livemode mismatch, sync failure');
  assert.equal((posts.match(/await reportFailure\(event, '(config|sync)'/g) ?? []).length, 3);
  const report = route.slice(route.indexOf('async function reportFailure'), route.indexOf('async function recordEventError'));
  assert.ok(report.includes('webhookFailureReport(') && report.includes('Sentry.captureMessage(r.message'));
  assert.ok(report.includes('try {') && report.includes('catch'), 'best effort');
  assert.equal(/user_id|customer|email/i.test(report.replace(/\/\*\*[\s\S]*?\*\//g, '')), false, 'nothing personal passed to Sentry');
});
