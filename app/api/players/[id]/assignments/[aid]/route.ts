import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateAssignment, type Recurrence } from '@/lib/players/mental';
import { ASSIGN_COLS, createNextOccurrence } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/**
 * Change a task:
 *  - { status: 'done' | 'open' | 'cancelled' }  (done: a repeating task gets its next occurrence)
 *  - { title, description, due_on, recurrence } (edit)
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, aid } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: cur, error: ce } = await s.supabase.from('player_assignments').select('id,player_id,title,description,due_on,recurrence,questionnaire_id,series_id,status').eq('id', aid).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body && body.title === undefined && (body.status === 'done' || body.status === 'open' || body.status === 'cancelled')) {
    patch = body.status === 'done' ? { status: 'done', done_at: now, done_by: 'coach', updated_at: now } : { status: body.status, done_at: null, done_by: null, updated_at: now };
  } else {
    const v = validateAssignment(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch = { ...v.value, updated_at: now };
  }
  const { data, error } = await s.supabase.from('player_assignments').update(patch).eq('id', aid).eq('player_id', id).select(ASSIGN_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let next: string | null = null;
  if (patch.status === 'done' && cur.status === 'open') {
    next = await createNextOccurrence(s.supabase as never, { ...cur, coach_id: s.userId, recurrence: cur.recurrence as Recurrence });
  }
  return NextResponse.json({ assignment: data[0], next_due: next });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, aid } = await ctx.params;
  const { data, error } = await s.supabase.from('player_assignments').delete().eq('id', aid).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
