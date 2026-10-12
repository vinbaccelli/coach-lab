import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { priceIdFor, tierForPriceId, PRICE_ENV } from '@/lib/stripe';

const ALL = ['LIGHT', 'PRO', 'ACADEMY'].flatMap((p) => ['MONTHLY', 'YEARLY'].map((c) => `STRIPE_PRICE_${p}_${c}`));
beforeEach(() => {
  for (const k of [...ALL, 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY']) delete process.env[k];
});

test('each (plan, cycle) reads exactly its own env var', () => {
  assert.deepEqual(Object.values(PRICE_ENV).flatMap((c) => Object.values(c)).sort(), [...ALL].sort());
  for (const k of ALL) process.env[k] = `price_${k.toLowerCase()}`;
  assert.equal(priceIdFor('pro', 'yearly'), 'price_stripe_price_pro_yearly');
  assert.equal(priceIdFor('light', 'monthly'), 'price_stripe_price_light_monthly');
});

test('fails closed: no fallback to the legacy vars or another plan', () => {
  process.env.STRIPE_PRICE_MONTHLY = 'price_legacy_m';
  process.env.STRIPE_PRICE_YEARLY = 'price_legacy_y';
  process.env.STRIPE_PRICE_LIGHT_YEARLY = 'price_light_y';
  assert.equal(priceIdFor('pro', 'monthly'), '');
  assert.equal(priceIdFor('pro', 'yearly'), '');
  assert.equal(priceIdFor('academy', 'yearly'), '');
  assert.equal(tierForPriceId('price_legacy_m'), null);
});

test('price → plan for the webhook', () => {
  for (const k of ALL) process.env[k] = `price_${k.toLowerCase()}`;
  assert.equal(tierForPriceId('price_stripe_price_academy_monthly'), 'academy');
  assert.equal(tierForPriceId('price_stripe_price_pro_yearly'), 'pro');
  assert.equal(tierForPriceId('price_stripe_price_light_yearly'), 'light');
  assert.equal(tierForPriceId('price_unknown'), null);
  assert.equal(tierForPriceId(undefined), null);
});
