import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { billingAccess } from '@/lib/entitlements';

/** Current coach's subscription status (RLS-scoped read of the subscriptions table). */
export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // `*` rather than a column list: it keeps working before and after the R1g
  // migration adds the period/interval/cancel columns.
  const { data, error } = await session.supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', session.userId)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    // Table may not be migrated yet — treat as "no subscription" instead of failing the page.
    return NextResponse.json({ status: 'none', email: session.email ?? null });
  }

  const row = data ?? {};
  const access = billingAccess({
    status: (row.status as string) ?? null,
    tier: (row.tier as string) ?? null,
    current_period_end: (row.current_period_end as string) ?? null,
    cancel_at_period_end: (row.cancel_at_period_end as boolean) ?? null,
  });
  return NextResponse.json({
    status: (row.status as string) ?? 'none',
    tier: (row.tier as string) ?? null,
    seats: (row.seats as number) ?? null,
    billingInterval: (row.billing_interval as string) ?? null,
    currentPeriodEnd: (row.current_period_end as string) ?? null,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    hasCustomer: !!row.stripe_customer_id,
    // Policy outcome (lib/entitlements.ts): what this subscription grants now.
    plan: access.plan,
    paymentFailed: access.paymentFailed,
    endsAt: access.endsAt,
    updatedAt: (row.updated_at as string) ?? null,
    email: session.email ?? null,
  });
}
