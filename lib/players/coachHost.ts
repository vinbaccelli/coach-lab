import { isAdmin } from '@/lib/admin';
import { billingAccess, canUse, type SubscriptionSnapshot } from '@/lib/entitlements';
import type { Db } from '@/lib/players/shareAccess';

/**
 * May this coach's YouTube channel host uploads from their players' share links? Same rule as the coach's
 * own YouTube upload (the Pro tools): admin, a complimentary Pro grant, or an active Pro subscription.
 * Server only (service role). Fails CLOSED: any read error means no. (A seat on someone else's Academy
 * plan is not counted here yet.) When the coach stops paying, the players' uploads stop with it.
 */
export async function coachMayHostUploads(db: Db, coachId: string): Promise<boolean> {
  try {
    const { data: u } = await db.auth.admin.getUserById(coachId);
    const email = u?.user?.email?.toLowerCase() ?? null;
    if (isAdmin(email)) return true;
    if (email) {
      const { data: g } = await db.from('access_grants').select('tier').eq('email', email).is('revoked_at', null).maybeSingle<{ tier: string }>();
      if (g?.tier === 'pro') return true;
    }
    const { data: sub, error } = await db.from('subscriptions').select('*').eq('user_id', coachId).maybeSingle<SubscriptionSnapshot>();
    if (error) return false;
    return canUse('youtube', { plan: billingAccess(sub).plan, trial: false, admin: false });
  } catch {
    return false;
  }
}
