import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { getEntitlement } from '@/lib/entitlements.server';
import { ACADEMY_EXTRA_SEATS, normalizeSeatEmail } from '@/lib/entitlements';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

/**
 * Academy seats, managed by the Academy subscriber (owner + 3 coaches).
 *
 * GET lists the owner's seats (RLS: owner-select). POST adds one and DELETE
 * removes one through the service role, because the table has no client write
 * policies: the active-Academy check and the seat limit live here (and the
 * limit is also a trigger in SQL). A member gets Pro-level tools while the
 * owner's Academy plan grants access — see lib/entitlements.server.ts.
 */

type Session = NonNullable<Awaited<ReturnType<typeof getRouteSession>>>;

async function ownerState(session: Session) {
  const ent = await getEntitlement(session.supabase, { id: session.userId, email: session.email }, { startTrial: false });
  return { canManage: ent.plan === 'academy' && !ent.academyMember };
}

async function listSeats(session: Session) {
  const { data, error } = await session.supabase
    .from('academy_members')
    .select('email, created_at')
    .eq('owner_user_id', session.userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ email: string; created_at: string }>;
}

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const [{ canManage }, members] = await Promise.all([ownerState(session), listSeats(session)]);
    return NextResponse.json({ canManage, seats: ACADEMY_EXTRA_SEATS, members }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[academy-members] list failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not load the coaches on your plan.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = normalizeSeatEmail(body.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (email === session.email?.toLowerCase()) {
    return NextResponse.json({ error: 'You already have the plan — add another coach’s email.' }, { status: 400 });
  }

  const db = createSupabaseServiceClient();
  if (!db) return NextResponse.json({ error: 'Seats are not available right now.' }, { status: 503 });

  try {
    const { canManage } = await ownerState(session);
    if (!canManage) {
      return NextResponse.json(
        { error: 'plan_required', required: 'academy', message: 'Adding coaches needs an active Academy plan.' },
        { status: 403 },
      );
    }
    const members = await listSeats(session);
    if (members.some((m) => m.email === email)) {
      return NextResponse.json({ error: 'That coach is already on your plan.' }, { status: 409 });
    }
    if (members.length >= ACADEMY_EXTRA_SEATS) {
      return NextResponse.json({ error: `Academy includes you plus ${ACADEMY_EXTRA_SEATS} coaches. Remove one to add another.` }, { status: 409 });
    }
    const { error } = await db.from('academy_members').insert({ owner_user_id: session.userId, email });
    if (error) {
      const full = /seat limit/i.test(error.message);
      return NextResponse.json(
        { error: full ? `Academy includes you plus ${ACADEMY_EXTRA_SEATS} coaches.` : 'Could not add that coach.' },
        { status: full || error.code === '23505' ? 409 : 500 },
      );
    }
    return NextResponse.json({ ok: true, members: await listSeats(session) });
  } catch (e) {
    console.error('[academy-members] add failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not add that coach.' }, { status: 500 });
  }
}

/** Remove a seat. Allowed whatever the owner's plan state (removing never grants anything). */
export async function DELETE(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const email = normalizeSeatEmail(new URL(req.url).searchParams.get('email'));
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const db = createSupabaseServiceClient();
  if (!db) return NextResponse.json({ error: 'Seats are not available right now.' }, { status: 503 });

  const { error } = await db.from('academy_members').delete().eq('owner_user_id', session.userId).eq('email', email);
  if (error) {
    console.error('[academy-members] remove failed:', error.message);
    return NextResponse.json({ error: 'Could not remove that coach.' }, { status: 500 });
  }
  try {
    return NextResponse.json({ ok: true, members: await listSeats(session) });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
