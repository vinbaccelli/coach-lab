import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { getEntitlement } from '@/lib/entitlements.server';
import { NO_ENTITLEMENT } from '@/lib/entitlements';

/**
 * The signed-in coach's entitlement for the client (toolbar locks, the
 * payment-failed banner, /billing). Read-only: never starts the trial.
 * Signed out → 401. A read error answers the empty entitlement with
 * `degraded: true` rather than failing the page.
 */
export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const ent = await getEntitlement(session.supabase, { id: session.userId, email: session.email }, { startTrial: false });
    return NextResponse.json(ent, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[entitlement] read failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ...NO_ENTITLEMENT, degraded: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
