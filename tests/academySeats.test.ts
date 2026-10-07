import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { academySeatGrants, ACADEMY_EXTRA_SEATS, canDownloadEbook, canUse, normalizeSeatEmail } from '@/lib/entitlements';
import { getEntitlement } from '@/lib/entitlements.server';
import { getPlan } from '@/lib/plans';

const sub = (tier: string, status = 'active', extra: Record<string, unknown> = {}) =>
  ({ tier, status, current_period_end: '2027-01-01T00:00:00.000Z', cancel_at_period_end: false, ...extra });

test('seat count matches the Academy plan (owner + 3)', () => {
  assert.equal(ACADEMY_EXTRA_SEATS, (getPlan('academy')?.seats ?? 0) - 1);
  assert.equal(ACADEMY_EXTRA_SEATS, 3);
});

test('a seat lives exactly as long as the owner’s Academy plan grants access', () => {
  assert.equal(academySeatGrants([sub('academy')]), true);
  assert.equal(academySeatGrants([sub('academy', 'trialing')]), true);
  assert.equal(academySeatGrants([sub('academy', 'past_due')]), true);
  assert.equal(academySeatGrants([sub('academy', 'active', { cancel_at_period_end: true })]), true);
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(academySeatGrants([sub('academy', status)]), false, status);
  }
  // Owner downgraded to Pro or Light: seats stop.
  assert.equal(academySeatGrants([sub('pro')]), false);
  assert.equal(academySeatGrants([sub('light')]), false);
  assert.equal(academySeatGrants([]), false);
  assert.equal(academySeatGrants(null), false);
  // Two owners, one still active.
  assert.equal(academySeatGrants([sub('academy', 'canceled'), sub('academy')]), true);
});

test('seat emails are normalised and validated', () => {
  assert.equal(normalizeSeatEmail('  Coach@Example.COM '), 'coach@example.com');
  for (const bad of ['', 'nope', 'a@b', '@x.com', 'a b@x.com', 42, null, undefined]) {
    assert.equal(normalizeSeatEmail(bad), null, String(bad));
  }
});

/** Supabase stand-in: own subscription row, trial row, and the two RPCs. */
function db(opts: { own?: Record<string, unknown> | null; seats?: unknown[] | null; seatError?: string; trialStartedAt?: string | null }) {
  const calls: string[] = [];
  const from = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      async maybeSingle() {
        if (table === 'subscriptions') return { data: opts.own ?? null, error: null };
        if (table === 'trials') return { data: opts.trialStartedAt ? { started_at: opts.trialStartedAt } : null, error: null };
        return { data: null, error: null };
      },
    };
    return q;
  };
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === 'academy_seat_subscriptions') {
      return opts.seatError ? { data: null, error: { message: opts.seatError } } : { data: opts.seats ?? [], error: null };
    }
    if (name === 'start_trial') return { data: new Date().toISOString(), error: null };
    return { data: null, error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, calls };
}

const user = { id: 'member-1', email: 'member@example.com' };

test('a coach with no plan on an active Academy seat resolves to Pro-level, without starting the free hour', async () => {
  const { client, calls } = db({ seats: [sub('academy')] });
  const e = await getEntitlement(client, user, { startTrial: true });
  assert.equal(e.plan, 'pro');
  assert.equal(e.academyMember, true);
  assert.equal(e.trial, false);
  assert.deepEqual(calls, ['academy_seat_subscriptions']);
  assert.equal(canUse('players', e), true);
  assert.equal(canUse('motionLayer', e), true);
  assert.equal(canDownloadEbook(e), false, 'the ebook is the subscriber’s, not the seat’s');
});

test('a Light subscriber who is also a seat gets Pro-level from the seat', async () => {
  const { client } = db({ own: { ...sub('light'), billing_interval: 'year' }, seats: [sub('academy')] });
  const e = await getEntitlement(client, user, { startTrial: false });
  assert.equal(e.plan, 'pro');
  assert.equal(e.academyMember, true);
});

test('Pro or Academy of their own: no seat lookup at all', async () => {
  for (const tier of ['pro', 'academy']) {
    const { client, calls } = db({ own: { ...sub(tier), billing_interval: 'year' }, seats: [sub('academy')] });
    const e = await getEntitlement(client, user, { startTrial: true });
    assert.equal(e.plan, tier);
    assert.equal(e.academyMember, false);
    assert.equal(e.interval, 'year');
    assert.deepEqual(calls, [], tier);
  }
});

test('lapsed owner: the seat grants nothing and the member falls back to their own state', async () => {
  const light = db({ own: { ...sub('light'), billing_interval: 'month' }, seats: [sub('academy', 'canceled')] });
  const e1 = await getEntitlement(light.client, user, { startTrial: false });
  assert.equal(e1.plan, 'light');
  assert.equal(e1.academyMember, false);

  const none = db({ seats: [sub('academy', 'unpaid')] });
  const e2 = await getEntitlement(none.client, user, { startTrial: true });
  assert.equal(e2.plan, null);
  assert.equal(e2.trial, true, 'falls through to the free hour');
  assert.deepEqual(none.calls, ['academy_seat_subscriptions', 'start_trial']);
});

test('seat lookup failure (SQL not run yet) counts as no seat, never as access', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { client } = db({ seatError: 'function academy_seat_subscriptions() does not exist' });
    const e = await getEntitlement(client, user, { startTrial: false });
    assert.equal(e.plan, null);
    assert.equal(e.academyMember, false);
  } finally {
    console.warn = warn;
  }
});
