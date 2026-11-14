import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { isYmd } from '@/lib/players/nutrition';
import { PQ_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/** Close or reopen a questionnaire, or change its due date. Its questions never change once sent. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, qid } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.status === 'open' || body?.status === 'closed') patch.status = body.status;
  if (body?.due_on === null || isYmd(body?.due_on)) patch.due_on = body?.due_on ?? null;
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  const { data, error } = await s.supabase.from('player_questionnaires').update(patch).eq('id', qid).eq('player_id', id).select(PQ_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ questionnaire: data[0] });
}

/** Delete a questionnaire with its answers (the page asks first). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, qid } = await ctx.params;
  const { data, error } = await s.supabase.from('player_questionnaires').delete().eq('id', qid).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
