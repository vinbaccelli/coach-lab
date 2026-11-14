import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import type { Recurrence } from '@/lib/players/mental';
import { ASSIGN_COLS, createNextOccurrence } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * The player ticks a task off (edit links only). A task that asks for a questionnaire is done by
 * answering it, not by ticking. A repeating task gets its next occurrence.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string; aid: string }> }) {
  const { token, aid } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  const { data: t } = await db.from('player_assignments').select('id,player_id,title,description,due_on,recurrence,questionnaire_id,series_id,status').eq('id', aid).eq('player_id', share.player_id).maybeSingle();
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  if (t.questionnaire_id) return NextResponse.json({ error: 'Answer the questionnaire to complete this task.' }, { status: 400, headers: NO_STORE });
  if (t.status !== 'open') return NextResponse.json({ error: 'This task is already closed.' }, { status: 409, headers: NO_STORE });
  const now = new Date().toISOString();
  const { data, error } = await db.from('player_assignments').update({ status: 'done', done_at: now, done_by: 'link', updated_at: now })
    .eq('id', aid).eq('player_id', share.player_id).eq('status', 'open').select(ASSIGN_COLS);
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return NextResponse.json({ error: 'This task is already closed.' }, { status: 409, headers: NO_STORE });
  const next = await createNextOccurrence(db as never, { ...t, coach_id: share.coach_id, recurrence: t.recurrence as Recurrence });
  return NextResponse.json({ assignment: data[0], next_due: next }, { headers: NO_STORE });
}
