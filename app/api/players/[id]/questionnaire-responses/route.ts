import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid, todayYmd } from '@/lib/players/routeKit';
import { validateAnswers, type Question } from '@/lib/players/mental';
import { isYmd, shiftDay } from '@/lib/players/nutrition';
import { RESP_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/** The coach fills an assessment (or a questionnaire with the player): { questionnaire_id, answered_on, answers }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isUuid(body?.questionnaire_id)) return NextResponse.json({ error: 'Choose a questionnaire' }, { status: 400 });
  const { data: q, error: qe } = await s.supabase.from('player_questionnaires').select('id,questions').eq('id', body.questionnaire_id).eq('player_id', id).maybeSingle();
  if (qe) return dbError(qe);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const v = validateAnswers(q.questions as Question[], body.answers);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const today = todayYmd();
  const answered_on = isYmd(body.answered_on) && body.answered_on <= shiftDay(today, 1) ? body.answered_on : today;
  const client_ref = isUuid(body.client_ref) ? body.client_ref : null;
  const { data, error } = await s.supabase.from('player_questionnaire_responses')
    .insert({ coach_id: s.userId, player_id: id, questionnaire_id: q.id, answered_on, answers: v.value, author: 'coach', status: 'approved', client_ref })
    .select(RESP_COLS).single();
  if (error?.code === '23505' && client_ref) {
    const { data: existing } = await s.supabase.from('player_questionnaire_responses').select(RESP_COLS).eq('player_id', id).eq('client_ref', client_ref).maybeSingle();
    if (existing) return NextResponse.json({ response: existing, duplicate: true });
  }
  if (error) return dbError(error);
  return NextResponse.json({ response: data });
}
