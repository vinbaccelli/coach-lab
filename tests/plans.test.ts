import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANS, NO_PRICES, getPlan, formatPrice, formatMaybePrice, planPrice, yearlyPerMonth, yearlySavingsPct,
  yearlySavingsLabel, maxYearlySavingsPct, yearlySavingsSentence, PRICE_TAX_NOTE, EBOOK_TITLE, type PlanPrices,
  planBonusLines, YEARLY_BONUS_COPY, YEARLY_BONUS_TEXT, PRICING_SUBHEAD,
} from '@/lib/plans';
import { readFileSync } from 'node:fs';
import { canDownloadEbook, NO_ENTITLEMENT } from '@/lib/entitlements';
import { REPORTS_IN_APP } from '@/lib/featureFlags';

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

// ── Pricing offers copy (ebook emphasis, yearly bonus behind a flag) ───────────

test('planBonusLines: yearly shows the ebook line on Pro and Academy only; monthly shows only the switch-to-yearly hint', () => {
  for (const id of ['pro', 'academy'] as const) {
    const plan = getPlan(id)!;
    assert.deepEqual(planBonusLines(plan, true), [plan.yearlyBonus]);
    assert.deepEqual(planBonusLines(plan, false), [plan.ebookHint]);
    assert.match(plan.ebookHint ?? '', new RegExp(`yearly.*${EBOOK_TITLE}`, 'i'));
  }
  const light = getPlan('light')!;
  assert.deepEqual(planBonusLines(light, true), []);
  assert.deepEqual(planBonusLines(light, false), []);
});

test('planBonusLines: the extra-month line is OFF by default and, when on, only on the yearly cycle', () => {
  assert.equal(YEARLY_BONUS_COPY, false, 'stays off until the Stripe side exists and Vin confirms the wording');
  for (const p of PLANS) assert.ok(!planBonusLines(p, true).includes(YEARLY_BONUS_TEXT), `${p.id} default`);
  for (const p of PLANS) {
    assert.ok(planBonusLines(p, true, { yearlyBonusCopy: true }).includes(YEARLY_BONUS_TEXT), `${p.id} yearly on`);
    assert.ok(!planBonusLines(p, false, { yearlyBonusCopy: true }).includes(YEARLY_BONUS_TEXT), `${p.id} monthly never`);
  }
  assert.doesNotMatch(JSON.stringify(PLANS), /extra month/i, 'not baked into the plan data');
});

test('the ebook promise in the copy matches who can download it', () => {
  const yearly = (plan: 'light' | 'pro' | 'academy') => ({ ...NO_ENTITLEMENT, plan, interval: 'year' as const });
  assert.equal(canDownloadEbook(yearly('pro')), true);
  assert.equal(canDownloadEbook(yearly('academy')), true);
  assert.equal(canDownloadEbook(yearly('light')), false);
  assert.equal(canDownloadEbook({ ...yearly('pro'), interval: 'month' }), false);
  for (const p of PLANS) assert.equal(Boolean(p.yearlyBonus), p.id !== 'light', p.id);
});

test('both pricing surfaces use the same bonus function and the subhead matches where reports live', () => {
  for (const file of ['app/pricing/PricingClient.tsx', 'components/LandingPage.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /planBonusLines\(plan, annual\)/, file);
  }
  assert.doesNotMatch(readFileSync('components/LandingPage.tsx', 'utf8'), /YEARLY_BONUS_COPY \? [^`]*Google/);
  assert.equal(PRICING_SUBHEAD.includes('Google Docs'), !REPORTS_IN_APP, 'subhead follows REPORTS_IN_APP');
});
