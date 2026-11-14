import { NextResponse } from 'next/server';
import { coachSession, dbError, todayYmd } from '@/lib/players/routeKit';
import { validateLog } from '@/lib/players/workouts';
import { LOG_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';

/**
 * Coach edits or reviews a log.
 *  - Review: { status: 'approved' | 'needs_revision', review_note? }  (logs the player sent)
 *  - Edit:   the log + `expected_updated_at` (a stale copy gets 409)
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; logId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, logId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body?.status === 'approved' || body?.status === 'needs_revision') {
    const note = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 1000) : '';
    if (body.status === 'needs_revision' && !note) return NextResponse.json({ error: 'Say what needs to change' }, { status: 400 });
    patch = { status: body.status, review_note: note || null, reviewed_at: now, updated_at: now };
  } else {
    const v = validateLog(body, todayYmd());
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch = { ...v.value, updated_at: now };
  }
  let q = s.supabase.from('player_workout_logs').update(patch).eq('id', logId).eq('player_id', id);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(LOG_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'This log was changed somewhere else, or it does not exist. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ log: data[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; logId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, logId } = await ctx.params;
  const { data, error } = await s.supabase.from('player_workout_logs').delete().eq('id', logId).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
