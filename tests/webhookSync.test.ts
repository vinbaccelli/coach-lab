import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { processStripeEvent, RetryableError, type SyncDeps, type SubscriptionRow } from '@/lib/billing/webhookSync';

const NOW = new Date('2026-10-05T12:00:00Z');
const PERIOD_END = Math.floor(Date.parse('2027-10-05T12:00:00Z') / 1000);

function sub(over: Partial<Stripe.Subscription> & { price?: string; interval?: 'month' | 'year' } = {}): Stripe.Subscription {
  const { price = 'price_pro_y', interval = 'year', ...rest } = over;
  return {
    id: 'sub_1', object: 'subscription', status: 'active', customer: 'cus_1',
    metadata: { userId: 'user_1', plan: 'pro' }, cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ price: { id: price, recurring: { interval } }, current_period_end: PERIOD_END }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}
const ev = (type: string, object: unknown, id = 'evt_1') => ({ id, type, data: { object } }) as unknown as Stripe.Event;

function harness(opts: { subscription?: Stripe.Subscription; processed?: string[]; failUpsert?: boolean; matched?: number } = {}) {
  const calls = { upserts: [] as SubscriptionRow[], updates: [] as Array<[string, Partial<SubscriptionRow>]>, recorded: [] as string[], retrieved: [] as string[], logs: [] as unknown[][] };
  const processed = new Set(opts.processed ?? []);
  const deps: SyncDeps = {
    async retrieveSubscription(id) { calls.retrieved.push(id); return opts.subscription ?? sub(); },
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
    user_id: 'user_1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active',
    tier: 'pro', seats: 1, billing_interval: 'year', current_period_end: '2027-10-05T12:00:00.000Z',
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
  assert.equal(await processStripeEvent(ev('charge.refunded', {}), deps), 'ignored');
  assert.equal(calls.recorded.length, 0);
});
