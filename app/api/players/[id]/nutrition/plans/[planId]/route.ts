import { NextResponse } from 'next/server';
import { coachSession, dbError, todayYmd } from '@/lib/players/routeKit';
import { isHistory, validatePlan } from '@/lib/players/nutrition';
import { PLAN_COLS } from '@/lib/players/mealPhotos';

export const runtime = 'nodejs';

const STATUSES = ['draft', 'active', 'archived'];

/**
 * Edit a plan.
 *  - Status only: { status: 'draft' | 'active' | 'archived' } (archive / restore; allowed on any plan).
 *  - Content: the whole plan + `expected_updated_at`. A plan whose period has ended is history and
 *    cannot be edited (duplicate it instead); a stale copy gets 409 instead of overwriting.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; planId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, planId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: cur, error: ce } = await s.supabase.from('player_nutrition_plans').select('id,ends_on,updated_at').eq('id', planId).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body && body.title === undefined && typeof body.status === 'string') {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
    patch = { status: body.status, updated_at: now };
  } else {
    if (isHistory(cur, todayYmd())) {
      return NextResponse.json({ error: 'This plan has ended and is kept as history. Duplicate it to make a new plan.' }, { status: 409 });
    }
    const v = validatePlan(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch = { ...v.value, updated_at: now };
  }
  let q = s.supabase.from('player_nutrition_plans').update(patch).eq('id', planId).eq('player_id', id);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(PLAN_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'This plan was changed somewhere else. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ plan: data[0] });
}

/** Delete a plan (the page asks first). A later version keeps working: its link to this one is cleared. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; planId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, planId } = await ctx.params;
  const { data, error } = await s.supabase.from('player_nutrition_plans').delete().eq('id', planId).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
