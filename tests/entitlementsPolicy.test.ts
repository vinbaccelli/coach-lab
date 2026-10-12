import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingAccess, hasAppAccess, NO_ENTITLEMENT } from '@/lib/entitlements';

const END = '2027-10-05T12:00:00.000Z';

test('access policy across every Stripe status', () => {
  const cases: Array<[string, boolean, boolean]> = [
    // status, grants plan, payment failed
    ['active', true, false],
    ['trialing', true, false],
    ['past_due', true, true],
    ['unpaid', false, false],
    ['canceled', false, false],
    ['incomplete', false, false],
    ['incomplete_expired', false, false],
    ['paused', false, false],
  ];
  for (const [status, grants, failed] of cases) {
    const a = billingAccess({ status, tier: 'pro', current_period_end: END, cancel_at_period_end: false });
    assert.equal(a.plan, grants ? 'pro' : null, status);
    assert.equal(a.paymentFailed, failed, status);
    assert.equal(a.endsAt, null, status);
  }
});

test('cancel_at_period_end keeps the plan and reports the end date', () => {
  const a = billingAccess({ status: 'active', tier: 'academy', current_period_end: END, cancel_at_period_end: true });
  assert.deepEqual(a, { plan: 'academy', paymentFailed: false, endsAt: END });
});

test('no row, unknown tier or null status grant nothing', () => {
  assert.equal(billingAccess(null).plan, null);
  assert.equal(billingAccess({ status: 'active', tier: 'enterprise' }).plan, null);
  assert.equal(billingAccess({ status: null, tier: 'pro' }).plan, null);
});

test('app access: any plan, the trial or admin', () => {
  assert.equal(hasAppAccess(NO_ENTITLEMENT), false);
  assert.equal(hasAppAccess({ ...NO_ENTITLEMENT, trial: true }), true);
  assert.equal(hasAppAccess({ ...NO_ENTITLEMENT, admin: true }), true);
  assert.equal(hasAppAccess({ ...NO_ENTITLEMENT, plan: 'light' }), true);
});
