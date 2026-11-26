import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY_TERM_NOTICE, TERMS } from '../lib/analysisPricing';

test('the monthly 12-month choice tells the client it renews automatically and that cancelling early loses the discount', () => {
  assert.match(MONTHLY_TERM_NOTICE, /renews automatically/i);
  assert.match(MONTHLY_TERM_NOTICE, /until you cancel/i);
  assert.match(MONTHLY_TERM_NOTICE, /discount no longer applies/i);
  assert.ok(TERMS.some((t) => t.id === 'monthly12' && !t.payUpFront), 'the notice belongs to the pay-monthly term');
});
