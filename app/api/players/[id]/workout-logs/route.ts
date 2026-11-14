import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid, todayYmd } from '@/lib/players/routeKit';
import { validateLog } from '@/lib/players/workouts';
import { LOG_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

/**
 * The coach logs what was done: for a planned workout (`workout_id`, one log each) or on its own.
 * `client_ref` makes a retry return the saved log.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: player, error: pe } = await s.supabase.from('players').select('id').eq('id', id).maybeSingle();
  if (pe) return dbError(pe);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const v = validateLog(body, todayYmd());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const client_ref = isUuid(body?.client_ref) ? body.client_ref : null;
  if (client_ref) {
    const { data: existing } = await s.supabase.from('player_workout_logs').select(LOG_COLS).eq('player_id', id).eq('client_ref', client_ref).maybeSingle();
    if (existing) return NextResponse.json({ log: existing, duplicate: true });
  }
  let workout_id: string | null = null;
  if (body?.workout_id !== undefined && body.workout_id !== null) {
    if (!isUuid(body.workout_id)) return NextResponse.json({ error: 'Unknown workout' }, { status: 400 });
    const { data: w, error: we } = await s.supabase.from('player_workouts').select('id').eq('id', body.workout_id).eq('player_id', id).maybeSingle();
    if (we) return dbError(we);
    if (!w) return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
    workout_id = w.id;
  }
  const { data, error } = await s.supabase.from('player_workout_logs')
    .insert({ coach_id: s.userId, player_id: id, workout_id, ...v.value, author: 'coach', status: 'approved', client_ref })
    .select(LOG_COLS).single();
  if (error?.code === '23505') {
    if (client_ref) {
      const { data: existing } = await s.supabase.from('player_workout_logs').select(LOG_COLS).eq('player_id', id).eq('client_ref', client_ref).maybeSingle();
      if (existing) return NextResponse.json({ log: existing, duplicate: true });
    }
    return NextResponse.json({ error: 'This workout already has a log. Open it to change it.' }, { status: 409 });
  }
  if (error) return dbError(error);
  return NextResponse.json({ log: data });
}
