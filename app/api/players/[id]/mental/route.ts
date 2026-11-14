import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { PQ_COLS, RESP_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/** The player's questionnaires and assessments with every answer (the coach's view). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const [qs, rs] = await Promise.all([
    s.supabase.from('player_questionnaires').select(PQ_COLS).eq('player_id', id).order('created_at', { ascending: false }).limit(300),
    s.supabase.from('player_questionnaire_responses').select(RESP_COLS).eq('player_id', id).order('answered_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000),
  ]);
  if (qs.error) return dbError(qs.error, { questionnaires: [], responses: [] });
  if (rs.error) return dbError(rs.error, { questionnaires: [], responses: [] });
  return NextResponse.json({ questionnaires: qs.data ?? [], responses: rs.data ?? [] });
}
