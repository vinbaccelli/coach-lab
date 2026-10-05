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
  /**
   * Plan the coach may use: from their own subscription, or 'pro' when they are
   * a seat on someone else's active Academy subscription (academyMember).
   */
  plan: PlanId | null;
  /** Billing cycle of the coach's OWN subscription ('year' | 'month'), if any. */
  interval?: 'month' | 'year' | null;
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
  plan: null, interval: null, trial: false, admin: false, academyMember: false, paymentFailed: false, endsAt: null,
};

/** May this account use the analysis app at all (any plan, the trial, or admin)? */
export function hasAppAccess(e: Entitlement): boolean {
  return e.admin || e.trial || e.plan !== null;
}

// ── Features ────────────────────────────────────────────────────────────────

/**
 * Every gated capability, the lowest plan that includes it (Vin's final split,
 * 2026-10-03) and where the gate can actually be enforced:
 *  - 'server': an API route refuses it (403 plan_required) — truly enforced.
 *  - 'client': it runs in the browser on local files; the toolbar lock is a
 *    courtesy a determined user can bypass by editing the bundle.
 */
export const FEATURES = {
  // Light
  draw:              { plan: 'light', enforced: 'client', label: 'Drawing tools' },
  ruler:             { plan: 'light', enforced: 'client', label: 'Ruler' },
  jointChain:        { plan: 'light', enforced: 'client', label: 'Joint chain' },
  angleDifferential: { plan: 'light', enforced: 'client', label: 'Angle differential' },
  skeleton:          { plan: 'light', enforced: 'client', label: 'AI skeleton' },
  aiDetect:          { plan: 'light', enforced: 'client', label: 'AI Detect Angles' },
  dataColumn:        { plan: 'light', enforced: 'client', label: 'Data column' },
  snapshot:          { plan: 'light', enforced: 'client', label: 'One snapshot' },
  screenshot:        { plan: 'light', enforced: 'client', label: 'Screenshots' },
  academy:           { plan: 'light', enforced: 'server', label: 'AngleMotion Academy' },
  // Pro
  recordingHub:      { plan: 'pro', enforced: 'client', label: 'Recording Hub' },
  motionLayer:       { plan: 'pro', enforced: 'client', label: 'Motion Layer' },
  youtube:           { plan: 'pro', enforced: 'server', label: 'YouTube upload' },
  players:           { plan: 'pro', enforced: 'server', label: 'Player database' },
  saveToPlayer:      { plan: 'pro', enforced: 'server', label: 'Save to player' },
  aiTrack:           { plan: 'pro', enforced: 'client', label: 'AI Track' },
  generate:          { plan: 'pro', enforced: 'client', label: 'Generate' },
  multiSnapshot:     { plan: 'pro', enforced: 'client', label: 'Multi-phase snapshots' },
  matchAnalyzer:     { plan: 'pro', enforced: 'server', label: 'Manual match analyzer' },
  matchDecoder:      { plan: 'pro', enforced: 'server', label: 'Match Decoder' },
  docsExport:        { plan: 'pro', enforced: 'server', label: 'Google Docs export' },
  coachProfile:      { plan: 'pro', enforced: 'server', label: 'Public coach profile' },
} as const satisfies Record<string, { plan: PlanId; enforced: 'server' | 'client'; label: string }>;

export type Feature = keyof typeof FEATURES;

const RANK: Record<PlanId, number> = { light: 1, pro: 2, academy: 3 };

/** May this coach use `feature`? Admins and the free hour may use everything. */
export function canUse(feature: Feature, e: Pick<Entitlement, 'plan' | 'trial' | 'admin'>): boolean {
  if (e.admin || e.trial) return true;
  return e.plan !== null && RANK[e.plan] >= RANK[FEATURES[feature].plan];
}

/** The plan a coach would need for `feature` (for upgrade copy). */
export function requiredPlan(feature: Feature): PlanId {
  return FEATURES[feature].plan;
}

/**
 * The Spin Mechanics ebook: a bonus of YEARLY Pro and Academy subscriptions,
 * for the subscriber themself (not Academy seat members, not the free hour).
 * Admins may download it.
 */
export function canDownloadEbook(e: Entitlement): boolean {
  if (e.admin) return true;
  if (e.academyMember || e.trial) return false;
  return (e.plan === 'pro' || e.plan === 'academy') && e.interval === 'year';
}
