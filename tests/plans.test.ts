import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANS, NO_PRICES, getPlan, formatPrice, formatMaybePrice, planPrice, yearlyPerMonth, yearlySavingsPct,
  yearlySavingsLabel, maxYearlySavingsPct, yearlySavingsSentence, PRICE_TAX_NOTE, EBOOK_TITLE, type PlanPrices,
} from '@/lib/plans';

// The live Stripe amounts at launch, as lib/billing/livePrices.ts returns them.
const LAUNCH: PlanPrices = {
  light: { monthly: 12.9, yearly: 129 },
  pro: { monthly: 34.9, yearly: 299 },
  academy: { monthly: 69.9, yearly: 599 },
};

test('plans carry no prices; seats per plan', () => {
  assert.deepEqual(PLANS.map((p) => [p.id, p.seats]), [['light', 1], ['pro', 1], ['academy', 4]]);
  assert.doesNotMatch(JSON.stringify(PLANS), /price/i);
});

test('formatPrice renders euros: two decimals unless whole', () => {
  assert.equal(formatPrice(12.9), '€12.90');
  assert.equal(formatPrice(129), '€129');
  assert.equal(formatPrice(34.9), '€34.90');
  assert.equal(formatPrice(yearlyPerMonth(LAUNCH, 'pro')!), '€24.92');
  assert.equal(formatMaybePrice(null), '—');
});

test('yearly savings: Light 16.7% (two months free), Pro and Academy 28.6%', () => {
  assert.equal(yearlySavingsPct(LAUNCH, 'light'), 16.7);
  assert.equal(yearlySavingsPct(LAUNCH, 'pro'), 28.6);
  assert.equal(yearlySavingsPct(LAUNCH, 'academy'), 28.6);
  assert.equal(yearlySavingsLabel(LAUNCH, 'light'), 'Save 16.7%: two months free');
  assert.equal(yearlySavingsLabel(LAUNCH, 'pro'), 'Save 28.6%');
  assert.equal(maxYearlySavingsPct(LAUNCH), 28.6);
  assert.equal(
    yearlySavingsSentence(LAUNCH),
    'Yearly costs less than twelve monthly payments: 16.7% less on Light (two months free), and 28.6% less on Pro and Academy.',
  );
});

test('a price change in Stripe flows through: savings follow the new amounts', () => {
  const changed: PlanPrices = { ...LAUNCH, pro: { monthly: 34.9, yearly: 200 } };
  assert.equal(planPrice(changed, 'pro', 'yearly'), 200);
  assert.equal(yearlySavingsPct(changed, 'pro'), 52.2);
  assert.equal(maxYearlySavingsPct(changed), 52.2);
});

test('missing or non-saving prices: nothing is advertised', () => {
  assert.equal(planPrice(NO_PRICES, 'pro', 'monthly'), null);
  assert.equal(yearlyPerMonth(NO_PRICES, 'pro'), null);
  assert.equal(yearlySavingsLabel(NO_PRICES, 'pro'), null);
  assert.equal(maxYearlySavingsPct(NO_PRICES), null);
  assert.equal(yearlySavingsSentence(NO_PRICES), null);
  // Yearly no cheaper than 12 × monthly: no "save" claim.
  assert.equal(yearlySavingsPct({ ...LAUNCH, light: { monthly: 10, yearly: 120 } }, 'light'), null);
});

test('ebook bonus: Pro and Academy only, Spin Mechanics', () => {
  assert.equal(getPlan('light')!.yearlyBonus, undefined);
  for (const id of ['pro', 'academy'] as const) assert.match(getPlan(id)!.yearlyBonus ?? '', new RegExp(EBOOK_TITLE));
});

test('copy rules: tax line, no VAT claim, no 13+, no "on every plan"', () => {
  assert.equal(PRICE_TAX_NOTE, 'Prices are final: no extra taxes at checkout.');
  const all = JSON.stringify(PLANS);
  assert.doesNotMatch(all, /VAT|13\+|on every plan|founding|OnForm|CoachNow|Dartfish|\$/i);
});
