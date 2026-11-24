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

import { subscriptionProblems, EMPTY_SUBSCRIPTION_OFFER, sanitizeSubscriptionOffer as sanitizeOffer } from '../lib/analysisPricing';

test('switched on with no analysis type: says what is missing (the server would drop it)', () => {
  const p = subscriptionProblems({ ...EMPTY_SUBSCRIPTION_OFFER, enabled: true });
  assert.ok(p.some((m) => /at least one analysis type/i.test(m)));
  assert.equal(sanitizeOffer({ enabled: true, offers: [] }).enabled, false);
});
test('a type without a price is reported and not shown; a complete one clears the main problem', () => {
  const half = { ...EMPTY_SUBSCRIPTION_OFFER, enabled: true, offers: [{ id: 'a', title: 'Quick', description: '', unitCents: 0, currency: 'EUR' }] };
  assert.ok(subscriptionProblems(half).some((m) => /at least one analysis type/i.test(m)));
  const ok = { ...half, offers: [{ ...half.offers[0], unitCents: 2500 }] };
  assert.ok(!subscriptionProblems(ok).some((m) => /at least one analysis type/i.test(m)));
  assert.equal(sanitizeOffer(ok).enabled, true);
});
test('missing payment links are listed; switched off says nothing', () => {
  const on = { ...EMPTY_SUBSCRIPTION_OFFER, enabled: true, offers: [{ id: 'a', title: 'Quick', description: '', unitCents: 2500, currency: 'EUR' }] };
  assert.ok(subscriptionProblems(on).some((m) => /payment link/i.test(m)));
  assert.deepEqual(subscriptionProblems({ ...on, enabled: false }), []);
});

test('exact-combination payment links: used first, per-term link is the fallback, junk is dropped', async () => {
  const { comboLinkKey, payLinkFor, subscriptionProblems } = await import('../lib/analysisPricing');
  const raw = {
    enabled: true,
    offers: [{ id: 'quick', title: 'Quick', unitCents: 2000, currency: 'EUR' }],
    frequencies: ['weekly', 'monthly'],
    payLinks: { prepaid12: 'https://fallback.example/p12' },
    comboLinks: {
      [comboLinkKey('quick', 'weekly', 'prepaid6')]: 'https://buy.stripe.com/a',
      [comboLinkKey('gone', 'weekly', 'prepaid6')]: 'https://buy.stripe.com/other-type',
      [comboLinkKey('quick', 'monthly', 'prepaid6')]: 'javascript:alert(1)',
    },
  };
  const o = sanitizeSubscriptionOffer(raw);
  assert.equal(payLinkFor(o, 'quick', 'weekly', 'prepaid6'), 'https://buy.stripe.com/a');
  assert.equal(payLinkFor(o, 'quick', 'weekly', 'prepaid12'), 'https://fallback.example/p12');
  assert.equal(payLinkFor(o, 'quick', 'monthly', 'prepaid6'), '');
  assert.equal(Object.keys(o.comboLinks ?? {}).length, 1);
  // 1 type x 2 frequencies x 3 terms = 6 options; weekly/prepaid6 and the two prepaid12 have a link.
  assert.deepEqual(subscriptionProblems(o), ['3 of 6 options have no payment link yet. Clients will see them but cannot pay through them.']);
});
