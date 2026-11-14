import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { RESP_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/** The coach marks the player's answers as read (approved) or asks for a fix with a note. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, rid } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.status !== 'approved' && body?.status !== 'needs_revision') return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
  const note = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 1000) : '';
  if (body.status === 'needs_revision' && !note) return NextResponse.json({ error: 'Say what needs to change' }, { status: 400 });
  const now = new Date().toISOString();
  const { data, error } = await s.supabase.from('player_questionnaire_responses')
    .update({ status: body.status, review_note: note || null, reviewed_at: now, updated_at: now }).eq('id', rid).eq('player_id', id).select(RESP_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ response: data[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, rid } = await ctx.params;
  const { data, error } = await s.supabase.from('player_questionnaire_responses').delete().eq('id', rid).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
