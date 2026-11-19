import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveriesInTerm, quote, sanitizeSubscriptionOffer, safeHttpUrl, TERMS, formatMoney,
} from '../lib/analysisPricing';

test('the three discounts are 10 / 10 / 20 percent', () => {
  assert.deepEqual(TERMS.map((t) => [t.id, t.discountPct]), [['monthly12', 10], ['prepaid6', 10], ['prepaid12', 20]]);
});

test('deliveries per term follow the frequency', () => {
  assert.equal(deliveriesInTerm('monthly', 'monthly12'), 12);
  assert.equal(deliveriesInTerm('biweekly', 'prepaid6'), 13);
  assert.equal(deliveriesInTerm('weekly', 'prepaid12'), 52);
});

test('quote: total, saving and monthly instalment', () => {
  const q = quote(5000, 'monthly', 'prepaid12'); // 12 x 50.00 = 600.00, minus 20%
  assert.equal(q.fullCents, 60000);
  assert.equal(q.totalCents, 48000);
  assert.equal(q.savedCents, 12000);
  assert.equal(q.payUpFront, true);
  assert.equal(q.monthlyCents, 0);
  const m = quote(5000, 'monthly', 'monthly12'); // minus 10%, paid monthly
  assert.equal(m.totalCents, 54000);
  assert.equal(m.monthlyCents, 4500);
  assert.equal(m.payUpFront, false);
});

test('only http(s) pay links survive', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('data:text/html,x'), '');
  assert.equal(safeHttpUrl('not a url'), '');
  assert.equal(safeHttpUrl(' https://pay.example.com/x '), 'https://pay.example.com/x');
});

test('sanitize drops bad offers, caps them, and never enables an empty storefront', () => {
  const s = sanitizeSubscriptionOffer({
    enabled: true,
    offers: [
      { title: '', unitCents: 1000 },
      { title: 'Quick', unitCents: -5 },
      { title: 'Quick', unitCents: 2500.4, currency: 'usd', description: 'x' },
    ],
    frequencies: ['weekly', 'daily', 'weekly'],
    payLinks: { monthly12: 'https://a.example/pay', prepaid6: 'javascript:1', bogus: 'https://x.example' },
  });
  assert.equal(s.offers.length, 1);
  assert.equal(s.offers[0].unitCents, 2500);
  assert.equal(s.offers[0].currency, 'USD');
  assert.deepEqual(s.frequencies, ['weekly']);
  assert.deepEqual(s.payLinks, { monthly12: 'https://a.example/pay' });
  assert.equal(s.enabled, true);
  assert.equal(sanitizeSubscriptionOffer({ enabled: true, offers: [] }).enabled, false);
  assert.equal(sanitizeSubscriptionOffer(null).enabled, false);
  const many = sanitizeSubscriptionOffer({ offers: Array.from({ length: 20 }, () => ({ title: 'a', unitCents: 100 })) });
  assert.equal(many.offers.length, 6);
});

test('formatMoney falls back to EUR for a bad currency code', () => {
  assert.match(formatMoney(4500, 'zz!'), /45/);
});
