import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateExercise } from '@/lib/players/workouts';
import { EXERCISE_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

/** The exercise library: the global exercises and the coach's own (RLS decides which). */
export async function GET() {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { data, error } = await s.supabase.from('exercise_library').select(EXERCISE_COLS).is('archived_at', null).order('name', { ascending: true }).limit(1000);
  if (error) return dbError(error, { exercises: [] });
  return NextResponse.json({ exercises: data ?? [] });
}

/** A custom exercise of this coach. */
export async function POST(req: Request) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const v = validateExercise(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await s.supabase.from('exercise_library').insert({ coach_id: s.userId, ...v.value }).select(EXERCISE_COLS).single();
  if (error) return dbError(error);
  return NextResponse.json({ exercise: data });
}
