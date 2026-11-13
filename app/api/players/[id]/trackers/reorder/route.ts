import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid } from '@/lib/players/routeKit';

export const runtime = 'nodejs';

/** Save the drag-and-drop order of trackers: { ids: [...] } in the new order. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter(isUuid).slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  for (let i = 0; i < ids.length; i++) {
    const { error } = await s.supabase.from('player_trackers').update({ position: i }).eq('id', ids[i]).eq('player_id', id);
    if (error) return dbError(error);
  }
  return NextResponse.json({ ok: true });
}
