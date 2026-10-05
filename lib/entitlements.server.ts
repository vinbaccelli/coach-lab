import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdmin } from '@/lib/admin';
import { billingAccess, NO_ENTITLEMENT, type Entitlement, type SubscriptionSnapshot } from '@/lib/entitlements';

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

  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('status, tier, current_period_end, cancel_at_period_end')
    .eq('user_id', user.id)
    .maybeSingle<SubscriptionSnapshot>();
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);
  const own = billingAccess(sub);
  if (own.plan) return { ...NO_ENTITLEMENT, ...own };

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
