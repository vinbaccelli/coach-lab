import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceMismatch, sellableAmount, type PriceFacts } from '@/lib/billing/checkoutGuard';

const ok: PriceFacts = { id: 'price_pro_y', active: true, currency: 'eur', unit_amount: 29900, recurring: { interval: 'year', interval_count: 1 } };

test('active EUR price on the right interval is sellable, at its own amount', () => {
  assert.equal(priceMismatch('yearly', ok), null);
  assert.equal(sellableAmount('yearly', ok), 299);
  // Any amount is fine: the site shows this price's amount, so shown = charged.
  assert.equal(sellableAmount('yearly', { ...ok, unit_amount: 20000 }), 200);
  assert.equal(sellableAmount('monthly', { ...ok, unit_amount: 1290, recurring: { interval: 'month' } }), 12.9);
});

test('refuses: wrong currency, archived, no fixed amount, wrong interval', () => {
  assert.match(priceMismatch('yearly', { ...ok, currency: 'usd' })!, /usd/);
  assert.match(priceMismatch('yearly', { ...ok, active: false })!, /archived/);
  assert.match(priceMismatch('yearly', { ...ok, unit_amount: null })!, /no fixed amount/);
  assert.match(priceMismatch('yearly', { ...ok, recurring: { interval: 'month', interval_count: 12 } })!, /expected 1 year/);
  assert.match(priceMismatch('monthly', ok)!, /expected 1 month/);
  assert.match(priceMismatch('yearly', { ...ok, recurring: null })!, /expected 1 year/);
  assert.equal(sellableAmount('yearly', { ...ok, currency: 'usd' }), null);
});
