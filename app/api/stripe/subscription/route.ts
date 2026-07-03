import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

/** Current coach's subscription status (RLS-scoped read of the subscriptions table). */
export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await session.supabase
    .from('subscriptions')
    .select('status, stripe_subscription_id, updated_at')
    .eq('user_id', session.userId)
    .maybeSingle<{ status: string; stripe_subscription_id: string | null; updated_at: string }>();

  if (error) {
    // Table may not be migrated yet — treat as "no subscription" instead of failing the page.
    return NextResponse.json({ status: 'none', email: session.email ?? null });
  }

  return NextResponse.json({
    status: data?.status ?? 'none',
    updatedAt: data?.updated_at ?? null,
    email: session.email ?? null,
  });
}
