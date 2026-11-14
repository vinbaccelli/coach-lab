import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateExercise } from '@/lib/players/workouts';
import { EXERCISE_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

const notYours = () => NextResponse.json({ error: 'Only your own exercises can be changed. Make a copy of a built-in one to adapt it.' }, { status: 404 });

/** Edit one of the coach's own exercises (built-in ones are read-only: RLS changes no row, answer 404). */
export async function PATCH(req: Request, ctx: { params: Promise<{ exerciseId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { exerciseId } = await ctx.params;
  const v = validateExercise(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await s.supabase.from('exercise_library').update({ ...v.value, updated_at: new Date().toISOString() })
    .eq('id', exerciseId).eq('coach_id', s.userId).select(EXERCISE_COLS);
  if (error) return dbError(error);
  if (!data?.length) return notYours();
  return NextResponse.json({ exercise: data[0] });
}

/** Delete one of the coach's own exercises. Workouts keep their copy of its name and plan. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ exerciseId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { exerciseId } = await ctx.params;
  const { data, error } = await s.supabase.from('exercise_library').delete().eq('id', exerciseId).eq('coach_id', s.userId).select('id');
  if (error) return dbError(error);
  if (!data?.length) return notYours();
  return NextResponse.json({ ok: true });
}
