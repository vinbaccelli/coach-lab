import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid } from '@/lib/players/routeKit';

export const runtime = 'nodejs';

/** Approve several meals the player logged at once (a day, or everything waiting). Body: { ids }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter(isUuid).slice(0, 300) : [];
  if (!ids.length) return NextResponse.json({ error: 'Nothing to approve' }, { status: 400 });
  const now = new Date().toISOString();
  const { data, error } = await s.supabase.from('player_meal_logs')
    .update({ status: 'approved', review_note: null, reviewed_at: now, updated_at: now })
    .eq('player_id', id).in('id', ids).neq('status', 'approved').select('id');
  if (error) return dbError(error);
  return NextResponse.json({ approved: (data ?? []).map((m) => m.id) });
}
