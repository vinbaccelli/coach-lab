import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { parseCursor, parseFilter } from '@/lib/players/history';
import { loadHistory } from '@/lib/players/historySources';

export const runtime = 'nodejs';

/**
 * The player's universal timeline for the coach: every module merged, newest first, one page at a
 * time. Query: before (cursor from the previous page), limit (default 30, max 100), types, sections,
 * author (coach | link), from, to.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const { data: player, error } = await s.supabase.from('players').select('id').eq('id', id).maybeSingle();
  if (error) return dbError(error);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 30));
  const r = await loadHistory(s.supabase, { viewer: 'coach', playerId: id, filter: parseFilter(sp), cursor: parseCursor(sp.get('before')), limit, sections: null });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json(r);
}
