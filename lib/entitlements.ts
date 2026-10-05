import { isValidPlanId, type PlanId } from '@/lib/plans';

/**
 * Entitlements — THE single place that decides who may use what.
 *
 * Pure (no I/O): lib/entitlements.server.ts gathers the inputs (subscription
 * row, trial clock, admin list, Academy membership) and everything else —
 * middleware, API guards, the toolbar, /billing — asks this module.
 *
 * Subscription status policy (Vin, 2026-10-05):
 *  - active, trialing ............ full access to the plan.
 *  - active + cancel_at_period_end  full access until current_period_end, with
 *                                   an "ends on <date>" note on /billing (Stripe
 *                                   flips the status to canceled at that date).
 *  - past_due .................... access KEPT while Stripe retries the card,
 *                                   with a "payment failed, update your card"
 *                                   banner linking to the Stripe portal.
 *  - unpaid, canceled, incomplete,
 *    incomplete_expired, paused .. no paid features. Saved data stays readable;
 *                                   nothing is ever deleted.
 * The one free hour and admin accounts bypass every gate.
 */

export interface SubscriptionSnapshot {
  status: string | null;
  tier: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

export interface BillingAccess {
  /** The plan the subscription currently grants, or null for none. */
  plan: PlanId | null;
  /** past_due: the last renewal failed and Stripe is retrying. */
  paymentFailed: boolean;
  /** Set when the subscription is cancelled at period end: access stops then. */
  endsAt: string | null;
}

const GRANTING = new Set(['active', 'trialing', 'past_due']);

export function billingAccess(sub: SubscriptionSnapshot | null | undefined): BillingAccess {
  if (!sub || !sub.status || !GRANTING.has(sub.status) || !isValidPlanId(sub.tier)) {
    return { plan: null, paymentFailed: false, endsAt: null };
  }
  return {
    plan: sub.tier,
    paymentFailed: sub.status === 'past_due',
    endsAt: sub.cancel_at_period_end ? sub.current_period_end ?? null : null,
  };
}

export interface Entitlement {
  /** Plan from the coach's own subscription, or from an Academy owner's (as 'academy'). */
  plan: PlanId | null;
  /** Inside the free hour: every tool. */
  trial: boolean;
  /** Admin account: every tool. */
  admin: boolean;
  /** The plan comes from someone else's Academy subscription (seat member). */
  academyMember: boolean;
  paymentFailed: boolean;
  endsAt: string | null;
}

export const NO_ENTITLEMENT: Entitlement = {
  plan: null, trial: false, admin: false, academyMember: false, paymentFailed: false, endsAt: null,
};

/** May this account use the analysis app at all (any plan, the trial, or admin)? */
export function hasAppAccess(e: Entitlement): boolean {
  return e.admin || e.trial || e.plan !== null;
}
