import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid, todayYmd } from '@/lib/players/routeKit';
import { validateAssignment } from '@/lib/players/mental';
import { shiftDay } from '@/lib/players/nutrition';
import { ASSIGN_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/** The player's to-do: everything open, and what was done or cancelled in the last 30 days. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const since = `${shiftDay(todayYmd(), -30)}T00:00:00Z`;
  const [open, closed] = await Promise.all([
    s.supabase.from('player_assignments').select(ASSIGN_COLS).eq('player_id', id).eq('status', 'open').order('due_on', { ascending: true }).limit(300),
    s.supabase.from('player_assignments').select(ASSIGN_COLS).eq('player_id', id).neq('status', 'open').gte('updated_at', since).order('updated_at', { ascending: false }).limit(100),
  ]);
  if (open.error) return dbError(open.error, { assignments: [] });
  if (closed.error) return dbError(closed.error, { assignments: [] });
  return NextResponse.json({ assignments: [...(open.data ?? []), ...(closed.data ?? [])] });
}

/** A task for the player: title, description, due date, repeat (none, daily, weekly, monthly). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateAssignment(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const questionnaire_id = isUuid(body?.questionnaire_id) ? body.questionnaire_id : null;
  const { data, error } = await s.supabase.from('player_assignments').insert({ coach_id: s.userId, player_id: id, ...v.value, questionnaire_id }).select(ASSIGN_COLS).single();
  if (error) return dbError(error);
  return NextResponse.json({ assignment: data });
}
