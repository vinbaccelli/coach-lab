import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateWorkout } from '@/lib/players/workouts';
import { TEMPLATE_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

/**
 * Edit a template (with `expected_updated_at`: a stale copy gets 409). Workouts already planned from
 * it keep their own copy of the plan: changing a template never changes a player's history.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { templateId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateWorkout(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  let q = s.supabase.from('workout_templates').update({ ...v.value, updated_at: new Date().toISOString() }).eq('id', templateId);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(TEMPLATE_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'This template was changed somewhere else, or it does not exist. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ template: data[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { templateId } = await ctx.params;
  const { data, error } = await s.supabase.from('workout_templates').delete().eq('id', templateId).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
