import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { isMissingTable } from '@/lib/db/missingTable';

/** Shared plumbing for the coach-side player-database routes. RLS (own coach) stays the access rule. */
export type CoachSession = NonNullable<Awaited<ReturnType<typeof getRouteSession>>>;

/** The signed-in coach, or a 401 response. With `write`, also the `players` feature (403 plan_required). */
export async function coachSession(opts: { write?: boolean } = {}): Promise<CoachSession | Response> {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (opts.write) {
    const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
    if (denied) return denied;
  }
  return session;
}

export const todayYmd = () => new Date().toISOString().slice(0, 10);

/** A database error as a response: "not set up yet" is a calm 200, anything else a 500 with the message. */
export function dbError(error: { code?: string | null; message?: string | null }, empty: Record<string, unknown> = {}) {
  if (isMissingTable(error)) return NextResponse.json({ setupNeeded: true, ...empty });
  return NextResponse.json({ error: error.message ?? 'Database error' }, { status: 500 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
