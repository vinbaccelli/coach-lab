import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANS, getPlan, formatPrice, yearlyPerMonth, yearlySavingsPct, yearlySavingsLabel,
  maxYearlySavingsPct, PRICE_TAX_NOTE, EBOOK_TITLE,
} from '@/lib/plans';

test('launch prices in EUR', () => {
  assert.deepEqual(PLANS.map((p) => [p.id, p.priceMonthly, p.priceYearly, p.seats]), [
    ['light', 12.9, 129, 1],
    ['pro', 34.9, 299, 1],
    ['academy', 69.9, 599, 4],
  ]);
});

test('formatPrice renders euros: two decimals unless whole', () => {
  assert.equal(formatPrice(12.9), '€12.90');
  assert.equal(formatPrice(129), '€129');
  assert.equal(formatPrice(34.9), '€34.90');
  assert.equal(formatPrice(yearlyPerMonth(getPlan('pro')!)), '€24.92');
});

test('yearly savings: Light 16.7% (two months free), Pro and Academy 28.6%', () => {
  assert.equal(yearlySavingsPct(getPlan('light')!), 16.7);
  assert.equal(yearlySavingsPct(getPlan('pro')!), 28.6);
  assert.equal(yearlySavingsPct(getPlan('academy')!), 28.6);
  assert.equal(yearlySavingsLabel(getPlan('light')!), 'Save 16.7%: two months free');
  assert.equal(yearlySavingsLabel(getPlan('pro')!), 'Save 28.6%');
  assert.equal(maxYearlySavingsPct(), 28.6);
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
