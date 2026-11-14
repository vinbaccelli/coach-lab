import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { isYmd } from '@/lib/players/nutrition';
import { validateWorkout } from '@/lib/players/workouts';
import { WORKOUT_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

const done = () => NextResponse.json({ error: 'This workout is done: its plan stays as it was. Delete the log first if it was a mistake.' }, { status: 409 });

/**
 * Change a planned workout:
 *  - { status: 'skipped' | 'planned' }   skip it, or plan it again
 *  - { scheduled_on }                     move it to another day
 *  - { title, notes, items, expected_updated_at }  change the plan (not once it is done; stale copy: 409)
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; workoutId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, workoutId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: cur, error: ce } = await s.supabase.from('player_workouts').select('id').eq('id', workoutId).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: logged, error: le } = await s.supabase.from('player_workout_logs').select('id').eq('workout_id', workoutId).limit(1);
  if (le) return dbError(le);
  const isDone = Boolean(logged?.length);

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body && body.title === undefined && (body.status === 'skipped' || body.status === 'planned')) {
    if (isDone) return done();
    patch = { status: body.status, updated_at: now };
  } else if (body && body.title === undefined && body.scheduled_on !== undefined) {
    if (!isYmd(body.scheduled_on)) return NextResponse.json({ error: 'Choose a date' }, { status: 400 });
    if (isDone) return done();
    patch = { scheduled_on: body.scheduled_on, updated_at: now };
  } else {
    if (isDone) return done();
    const v = validateWorkout(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch = { ...v.value, updated_at: now };
  }
  let q = s.supabase.from('player_workouts').update(patch).eq('id', workoutId).eq('player_id', id);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(WORKOUT_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'This workout was changed somewhere else. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ workout: data[0] });
}

/**
 * Remove a planned workout (?series=future: also the later dates of the same series that are not
 * done). A done workout stays: its log refers to it.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; workoutId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, workoutId } = await ctx.params;
  const { data: cur, error: ce } = await s.supabase.from('player_workouts').select('id,batch_id,scheduled_on').eq('id', workoutId).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const series = new URL(req.url).searchParams.get('series') === 'future' && cur.batch_id;
  let targets = [cur.id as string];
  if (series) {
    const { data: rest, error: re } = await s.supabase.from('player_workouts').select('id').eq('player_id', id).eq('batch_id', cur.batch_id).gte('scheduled_on', cur.scheduled_on);
    if (re) return dbError(re);
    targets = (rest ?? []).map((r) => r.id as string);
  }
  const { data: logged, error: le } = await s.supabase.from('player_workout_logs').select('workout_id').in('workout_id', targets);
  if (le) return dbError(le);
  const doneIds = new Set((logged ?? []).map((l) => l.workout_id as string));
  if (!series && doneIds.has(cur.id)) return done();
  const removable = targets.filter((t) => !doneIds.has(t));
  if (!removable.length) return NextResponse.json({ removed: [] });
  const { data, error } = await s.supabase.from('player_workouts').delete().eq('player_id', id).in('id', removable).select('id');
  if (error) return dbError(error);
  return NextResponse.json({ removed: (data ?? []).map((r) => r.id), kept: [...doneIds] });
}
