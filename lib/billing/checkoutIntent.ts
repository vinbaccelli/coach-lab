import type { BillingCycle, PlanId } from '@/lib/plans';

/**
 * Starting a Stripe Checkout from /pricing, signed in or not.
 *
 * Signed out, the visitor is sent to sign-in carrying the plan they picked;
 * sign-in returns them to `/pricing?plan=<plan>&interval=<interval>`, where the
 * checkout starts on its own. Only the six plan/interval pairs below are ever
 * accepted from a URL, and only same-origin paths are ever redirected to.
 *
 * Pure (fetch and the session check are injected) so it is unit-tested in
 * tests/checkoutIntent.test.ts; app/pricing/PricingClient.tsx wires it up.
 */

export const CHECKOUT_PLANS: readonly PlanId[] = ['light', 'pro', 'academy'];
export const CHECKOUT_INTERVALS: readonly BillingCycle[] = ['monthly', 'yearly'];

export interface CheckoutIntent {
  plan: PlanId;
  interval: BillingCycle;
}

export const CHECKOUT_SIGN_IN_MESSAGE = 'Please sign in to continue';
export const CHECKOUT_RETRY_MESSAGE = 'Something went wrong starting checkout. Please try again.';

/** The plan and interval carried in a URL, or null unless both are on the allowlist. */
export function parseCheckoutIntent(params: URLSearchParams): CheckoutIntent | null {
  const plan = params.get('plan');
  const interval = params.get('interval');
  if (!plan || !interval) return null;
  if (!(CHECKOUT_PLANS as readonly string[]).includes(plan)) return null;
  if (!(CHECKOUT_INTERVALS as readonly string[]).includes(interval)) return null;
  return { plan: plan as PlanId, interval: interval as BillingCycle };
}

/** Where sign-in returns to: /pricing with the intent, which resumes checkout. */
export function pricingResumePath(intent: CheckoutIntent): string {
  return `/pricing?plan=${intent.plan}&interval=${intent.interval}`;
}

/** The existing sign-in flow (/login?redirect=…), carrying the intent. */
export function signInUrlForCheckout(intent: CheckoutIntent): string {
  return `/login?redirect=${encodeURIComponent(pricingResumePath(intent))}`;
}

/**
 * `raw` if it is a path on this site, else `fallback`. Rejects absolute URLs,
 * protocol-relative `//host`, backslash tricks (`/\host`) and any scheme, so a
 * redirect parameter can never send a visitor to another origin.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return fallback;
  // Control characters and backslashes have no business in our paths and are how
  // browsers get talked into treating a "path" as a host.
  if (/[\u0000-\u001f\\]/.test(raw)) return fallback;
  try {
    const base = 'https://same-origin.invalid';
    const u = new URL(raw, base);
    if (u.origin !== base) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

export type CheckoutOutcome =
  /** Signed out: go to sign-in (the checkout API was not called). */
  | { kind: 'sign-in'; url: string }
  /** Checkout session created: go to Stripe. */
  | { kind: 'stripe'; url: string }
  /** Show `message` under the button and reset it. */
  | { kind: 'error'; message: string; signInUrl?: string };

export interface CheckoutDeps {
  isSignedIn: () => Promise<boolean>;
  fetch: typeof fetch;
}

/**
 * Start checkout for `intent`. Signed out: never calls the API. Signed in: the
 * same request as before (POST /api/stripe/checkout, `{ plan, cycle }`).
 */
export async function startCheckout(intent: CheckoutIntent, deps: CheckoutDeps): Promise<CheckoutOutcome> {
  let signedIn = false;
  try {
    signedIn = await deps.isSignedIn();
  } catch {
    signedIn = false;
  }
  if (!signedIn) return { kind: 'sign-in', url: signInUrlForCheckout(intent) };

  try {
    const res = await deps.fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: intent.plan, cycle: intent.interval }),
    });
    if (res.status === 401) {
      // The session expired between the check and the request.
      return { kind: 'error', message: CHECKOUT_SIGN_IN_MESSAGE, signInUrl: signInUrlForCheckout(intent) };
    }
    const data = (await res.json().catch(() => ({}))) as { url?: unknown };
    if (res.ok && typeof data.url === 'string' && data.url) return { kind: 'stripe', url: data.url };
    return { kind: 'error', message: CHECKOUT_RETRY_MESSAGE };
  } catch {
    return { kind: 'error', message: CHECKOUT_RETRY_MESSAGE };
  }
}

/**
 * After sign-in: read the intent from /pricing's query string. The plan and
 * interval params are always stripped from the returned query (`search`), so a
 * reload or a Back from Stripe does not start checkout again. A valid intent
 * whose visitor is signed in starts checkout; anything else starts nothing.
 */
export async function resumeCheckout(
  search: string,
  deps: CheckoutDeps,
): Promise<{ search: string; intent: CheckoutIntent | null; outcome: CheckoutOutcome | null }> {
  const params = new URLSearchParams(search);
  const intent = parseCheckoutIntent(params);
  const hadParams = params.has('plan') || params.has('interval');
  params.delete('plan');
  params.delete('interval');
  const rest = params.toString();
  const cleaned = hadParams ? (rest ? `?${rest}` : '') : search;
  if (!intent) return { search: cleaned, intent: null, outcome: null };

  let signedIn = false;
  try {
    signedIn = await deps.isSignedIn();
  } catch {
    signedIn = false;
  }
  // Not signed in after all (sign-in failed or was abandoned): land on
  // /pricing with nothing started, never loop back to sign-in.
  if (!signedIn) return { search: cleaned, intent, outcome: null };
  return { search: cleaned, intent, outcome: await startCheckout(intent, { ...deps, isSignedIn: async () => true }) };
}
