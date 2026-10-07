import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlan } from '@/lib/plans';
import { priceMismatch, type PriceFacts } from '@/lib/billing/checkoutGuard';

const pro = getPlan('pro')!;
const ok: PriceFacts = { id: 'price_pro_y', active: true, currency: 'eur', unit_amount: 29900, recurring: { interval: 'year', interval_count: 1 } };

test('matching EUR price passes', () => {
  assert.equal(priceMismatch(pro, 'yearly', ok), null);
  assert.equal(priceMismatch(getPlan('light')!, 'monthly', { ...ok, unit_amount: 1290, recurring: { interval: 'month' } }), null);
});

test('refuses: wrong currency, wrong amount, archived, wrong interval', () => {
  assert.match(priceMismatch(pro, 'yearly', { ...ok, currency: 'usd' })!, /usd/);
  assert.match(priceMismatch(pro, 'yearly', { ...ok, unit_amount: 20000 })!, /20000.*29900/);
  assert.match(priceMismatch(pro, 'yearly', { ...ok, active: false })!, /archived/);
  assert.match(priceMismatch(pro, 'yearly', { ...ok, recurring: { interval: 'month', interval_count: 12 } })!, /expected 1 year/);
  assert.match(priceMismatch(pro, 'monthly', ok)!, /29900, site shows 3490/);
  assert.match(priceMismatch(pro, 'yearly', { ...ok, recurring: null })!, /expected 1 year/);
});
