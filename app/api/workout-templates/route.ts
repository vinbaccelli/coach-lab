import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateWorkout } from '@/lib/players/workouts';
import { TEMPLATE_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

/** The coach's workout templates. */
export async function GET() {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { data, error } = await s.supabase.from('workout_templates').select(TEMPLATE_COLS).is('archived_at', null).order('title', { ascending: true }).limit(500);
  if (error) return dbError(error, { templates: [] });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const v = validateWorkout(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await s.supabase.from('workout_templates').insert({ coach_id: s.userId, ...v.value }).select(TEMPLATE_COLS).single();
  if (error) return dbError(error);
  return NextResponse.json({ template: data });
}
