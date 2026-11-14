import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid } from '@/lib/players/routeKit';
import { closeForVersion, validatePlan } from '@/lib/players/nutrition';
import { PLAN_COLS } from '@/lib/players/mealPhotos';

export const runtime = 'nodejs';

/**
 * Create a nutrition plan. Body: the plan (title, starts_on, ends_on, status, targets, meals, notes).
 *
 * New version: add `replaces` (the current plan's id) and `expected_updated_at`. The new plan is
 * saved first (previous_id = the old one), then the old plan's period is closed the day before the
 * new start. The old plan's content is never changed. If the old plan was changed elsewhere in the
 * meantime, the new one is removed again and the answer is 409, so nothing is half done.
 * Duplicate = the page sends a copy as a normal new plan.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: player, error: pe } = await s.supabase.from('players').select('id').eq('id', id).maybeSingle();
  if (pe) return dbError(pe);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const v = validatePlan(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  let old: { id: string; starts_on: string; ends_on: string | null; updated_at: string } | null = null;
  let close: { ends_on: string } | null = null;
  if (body?.replaces !== undefined) {
    if (!isUuid(body.replaces)) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
    const { data, error } = await s.supabase.from('player_nutrition_plans').select('id,starts_on,ends_on,updated_at').eq('id', body.replaces).eq('player_id', id).maybeSingle();
    if (error) return dbError(error);
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    old = data;
    const c = closeForVersion(data, v.value.starts_on);
    if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
    close = c.value;
  }

  const { data: plan, error } = await s.supabase.from('player_nutrition_plans')
    .insert({ coach_id: s.userId, player_id: id, ...v.value, previous_id: old?.id ?? null })
    .select(PLAN_COLS).single();
  if (error) return dbError(error);
  if (!old || !close) return NextResponse.json({ plan });

  let q = s.supabase.from('player_nutrition_plans').update({ ends_on: close.ends_on, updated_at: new Date().toISOString() }).eq('id', old.id).eq('player_id', id);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data: closed, error: ce } = await q.select(PLAN_COLS);
  if (ce || !closed?.length) {
    await s.supabase.from('player_nutrition_plans').delete().eq('id', plan.id);
    if (ce) return dbError(ce);
    return NextResponse.json({ error: 'This plan was changed somewhere else. Reload and try again.' }, { status: 409 });
  }
  return NextResponse.json({ plan, previous: closed[0] });
}
