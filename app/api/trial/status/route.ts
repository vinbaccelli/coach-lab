import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { isAdmin } from '@/lib/admin';
import { billingAccess } from '@/lib/entitlements';
import { TRIAL_MS } from '@/lib/entitlements.server';

/**
 * Remaining free-trial time for the current coach. READ-ONLY — it never starts a
 * trial (middleware does that on the first gated request); it only reports the
 * clock so the UI can show a countdown. Returns `subscribed` for paying coaches
 * and admins so the banner stays hidden for them.
 */
export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (isAdmin(session.email)) return NextResponse.json({ state: 'subscribed' });

  const { data: sub } = await session.supabase
    .from('subscriptions')
    .select('status, tier')
    .eq('user_id', session.userId)
    .maybeSingle<{ status: string; tier: string | null }>();
  // Same policy as every gate (lib/entitlements.ts): past_due still counts.
  if (billingAccess(sub).plan) {
    return NextResponse.json({ state: 'subscribed' });
  }

  const { data: trial } = await session.supabase
    .from('trials')
    .select('started_at')
    .eq('user_id', session.userId)
    .maybeSingle<{ started_at: string }>();

  if (!trial?.started_at) {
    return NextResponse.json({ state: 'none', remainingMs: TRIAL_MS });
  }
  const remainingMs = Math.max(0, TRIAL_MS - (Date.now() - new Date(trial.started_at).getTime()));
  return NextResponse.json({ state: remainingMs > 0 ? 'active' : 'expired', remainingMs });
}
