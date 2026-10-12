import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKOUT_RETRY_MESSAGE,
  CHECKOUT_SIGN_IN_MESSAGE,
  parseCheckoutIntent,
  resumeCheckout,
  safeRedirectPath,
  signInUrlForCheckout,
  startCheckout,
  type CheckoutDeps,
} from '@/lib/billing/checkoutIntent';

type Call = { url: string; init?: RequestInit };

/** Session check + fetch stand-ins that record every API call. */
function deps(signedIn: boolean, respond: () => Response | Promise<Response> = () => json(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' })) {
  const calls: Call[] = [];
  const d: CheckoutDeps = {
    isSignedIn: async () => signedIn,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond();
    }) as unknown as typeof fetch,
  };
  return { d, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('signed-out click: no checkout API call, sent to sign-in carrying plan and interval', async () => {
  const { d, calls } = deps(false);
  const out = await startCheckout({ plan: 'pro', interval: 'yearly' }, d);
  assert.equal(calls.length, 0, 'the checkout API must not be called when signed out');
  assert.equal(out.kind, 'sign-in');
  assert.equal(out.kind === 'sign-in' && out.url, '/login?redirect=%2Fpricing%3Fplan%3Dpro%26interval%3Dyearly');
  // The login page and the auth callback accept that return path unchanged.
  const redirect = new URL(out.kind === 'sign-in' ? out.url : '', 'https://x.test').searchParams.get('redirect');
  assert.equal(safeRedirectPath(redirect), '/pricing?plan=pro&interval=yearly');
});

test('a failing session check counts as signed out (no API call)', async () => {
  const { d, calls } = deps(true);
  d.isSignedIn = async () => { throw new Error('storage blocked'); };
  const out = await startCheckout({ plan: 'light', interval: 'monthly' }, d);
  assert.equal(calls.length, 0);
  assert.equal(out.kind, 'sign-in');
});

test('signed in: the same checkout request as before, then off to Stripe', async () => {
  const { d, calls } = deps(true);
  const out = await startCheckout({ plan: 'academy', interval: 'monthly' }, d);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/stripe/checkout');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(calls[0].init?.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { plan: 'academy', cycle: 'monthly' });
  assert.deepEqual(out, { kind: 'stripe', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
});

test('API 401 shows the inline sign-in message (with a sign-in link), not alert()', async () => {
  const { d } = deps(true, () => json(401, { error: 'Unauthorized' }));
  const out = await startCheckout({ plan: 'pro', interval: 'monthly' }, d);
  assert.deepEqual(out, {
    kind: 'error',
    message: CHECKOUT_SIGN_IN_MESSAGE,
    signInUrl: signInUrlForCheckout({ plan: 'pro', interval: 'monthly' }),
  });
  assert.equal(CHECKOUT_SIGN_IN_MESSAGE, 'Please sign in to continue');
});

test('any other API error, a body without a URL, or a network failure shows the retry message', async () => {
  for (const respond of [
    () => json(503, { error: 'Pro (yearly) can’t be purchased right now.' }),
    () => json(400, { error: 'Invalid plan' }),
    () => json(200, {}),
    () => new Response('<html>502</html>', { status: 502 }),
    () => { throw new TypeError('Failed to fetch'); },
  ]) {
    const { d } = deps(true, respond);
    const out = await startCheckout({ plan: 'pro', interval: 'yearly' }, d);
    assert.deepEqual(out, { kind: 'error', message: CHECKOUT_RETRY_MESSAGE });
  }
});

test('post-sign-in resume: valid plan + interval starts that checkout once and strips the params', async () => {
  const { d, calls } = deps(true);
  const r = await resumeCheckout('?plan=light&interval=yearly', d);
  assert.deepEqual(r.intent, { plan: 'light', interval: 'yearly' });
  assert.equal(r.search, '');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { plan: 'light', cycle: 'yearly' });
  assert.deepEqual(r.outcome, { kind: 'stripe', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
});

test('resume keeps unrelated params (the plan-gate notice) and drops only plan/interval', async () => {
  const { d } = deps(true);
  const r = await resumeCheckout('?required=pro&feature=motionLayer&plan=pro&interval=monthly', d);
  assert.equal(r.search, '?required=pro&feature=motionLayer');
  assert.equal(r.outcome?.kind, 'stripe');
});

test('resume while still signed out: lands on /pricing, nothing started, no loop back to sign-in', async () => {
  const { d, calls } = deps(false);
  const r = await resumeCheckout('?plan=pro&interval=yearly', d);
  assert.equal(calls.length, 0);
  assert.equal(r.outcome, null);
  assert.equal(r.search, '');
});

test('invalid or missing plan/interval params: nothing started', async () => {
  for (const q of [
    '?plan=enterprise&interval=yearly',
    '?plan=pro&interval=weekly',
    '?plan=Pro&interval=yearly',
    '?plan=pro',
    '?interval=yearly',
    '?plan=&interval=',
    '?plan=pro%20&interval=yearly',
    '?plan=__proto__&interval=yearly',
    '',
  ]) {
    const { d, calls } = deps(true);
    const r = await resumeCheckout(q, d);
    assert.equal(calls.length, 0, q);
    assert.equal(r.intent, null, q);
    assert.equal(r.outcome, null, q);
    assert.equal(new URLSearchParams(r.search).has('plan'), false, q);
    assert.equal(new URLSearchParams(r.search).has('interval'), false, q);
  }
  // A page with no checkout params keeps its query untouched.
  const { d } = deps(true);
  assert.equal((await resumeCheckout('?required=1', d)).search, '?required=1');
});

test('the allowlist is exactly the six plan/interval pairs', () => {
  const ok: string[] = [];
  for (const plan of ['light', 'pro', 'academy', 'free', 'team']) {
    for (const interval of ['monthly', 'yearly', 'weekly']) {
      if (parseCheckoutIntent(new URLSearchParams({ plan, interval }))) ok.push(`${plan}/${interval}`);
    }
  }
  assert.deepEqual(ok, ['light/monthly', 'light/yearly', 'pro/monthly', 'pro/yearly', 'academy/monthly', 'academy/yearly']);
});

test('redirects stay on this site (no open redirect)', () => {
  assert.equal(safeRedirectPath('/pricing?plan=pro&interval=yearly'), '/pricing?plan=pro&interval=yearly');
  assert.equal(safeRedirectPath('/analysis'), '/analysis');
  assert.equal(safeRedirectPath('/'), '/');
  for (const bad of [
    'https://evil.com', 'http://evil.com/pricing', '//evil.com', '//evil.com/pricing', '/\\evil.com',
    '\\\\evil.com', 'javascript:alert(1)', 'evil.com', '', null, undefined, '/\tevil', '/%0d%0aSet-Cookie',
  ]) {
    const out = safeRedirectPath(bad as string | null | undefined);
    assert.ok(out.startsWith('/') && !out.startsWith('//'), String(bad));
    assert.equal(new URL(out, 'https://anglemotion.com').origin, 'https://anglemotion.com', String(bad));
  }
  assert.equal(safeRedirectPath('//evil.com'), '/');
  assert.equal(safeRedirectPath('https://evil.com', '/pricing'), '/pricing');
});
