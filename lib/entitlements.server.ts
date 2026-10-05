import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdmin } from '@/lib/admin';
import { getPlan } from '@/lib/plans';
import {
  billingAccess, canUse, FEATURES, NO_ENTITLEMENT, requiredPlan,
  type Entitlement, type Feature, type SubscriptionSnapshot,
} from '@/lib/entitlements';

/** Free self-serve trial length: one hour per account (see start_trial() SQL). */
export const TRIAL_MS = 60 * 60 * 1000;

/**
 * Gather a signed-in coach's entitlement — the only code that reads the
 * billing tables for access decisions. Used by middleware (page gates), the
 * API guards and /api/entitlement (the client hook). Pure policy lives in
 * lib/entitlements.ts.
 *
 * `startTrial`: middleware passes true on gated page loads, which starts the
 * one free hour the first time (start_trial() is idempotent and can't be
 * reset). API routes pass false and only read the clock.
 *
 * Throws on a database error; callers decide whether to fail open (page
 * gates, so an outage never locks paying coaches out) or closed.
 */
export async function getEntitlement(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  opts: { startTrial: boolean; now?: number } = { startTrial: false },
): Promise<Entitlement> {
  if (isAdmin(user.email)) return { ...NO_ENTITLEMENT, admin: true };

  // `*`, not a column list: works before and after the R1g migration.
  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle<SubscriptionSnapshot & { billing_interval?: string | null }>();
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);
  const own = billingAccess(sub);
  if (own.plan) {
    const interval = sub?.billing_interval === 'year' || sub?.billing_interval === 'month' ? sub.billing_interval : null;
    return { ...NO_ENTITLEMENT, ...own, interval };
  }

  const now = opts.now ?? Date.now();
  let startedAt: string | null = null;
  if (opts.startTrial) {
    const { data } = await supabase.rpc('start_trial');
    startedAt = (data as string | null) ?? null;
  } else {
    const { data } = await supabase.from('trials').select('started_at').eq('user_id', user.id).maybeSingle<{ started_at: string }>();
    startedAt = data?.started_at ?? null;
  }
  const trial = !!startedAt && now - new Date(startedAt).getTime() < TRIAL_MS;
  return { ...NO_ENTITLEMENT, trial };
}

/**
 * API guard: 403 `{ error: 'plan_required', feature, required }` unless the
 * signed-in coach may use `feature`; null when allowed. Read errors fail OPEN
 * (logged) so a database hiccup never locks paying coaches out of their work.
 */
export async function requireFeature(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  feature: Feature,
): Promise<Response | null> {
  try {
    const ent = await getEntitlement(supabase, user, { startTrial: false });
    if (canUse(feature, ent)) return null;
    const required = requiredPlan(feature);
    // Plain web Response (route handlers accept it): keeps this module free of
    // next/server so the guard is unit-testable under node --test.
    return Response.json(
      {
        error: 'plan_required',
        feature,
        required,
        message: `${FEATURES[feature].label} is part of the ${getPlan(required)?.name ?? required} plan.`,
      },
      { status: 403 },
    );
  } catch (e) {
    console.error('[entitlements] guard read failed, allowing:', feature, e instanceof Error ? e.message : e);
    return null;
  }
}
