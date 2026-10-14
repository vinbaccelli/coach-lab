import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoCodesAllowed } from '@/lib/billing/promoCodes';

test('the promotion code field shows on Pro yearly and Academy yearly only', () => {
  assert.equal(promoCodesAllowed('pro', 'yearly'), true);
  assert.equal(promoCodesAllowed('academy', 'yearly'), true);
  assert.equal(promoCodesAllowed('pro', 'monthly'), false);
  assert.equal(promoCodesAllowed('academy', 'monthly'), false);
  assert.equal(promoCodesAllowed('light', 'yearly'), false);
  assert.equal(promoCodesAllowed('light', 'monthly'), false);
});
