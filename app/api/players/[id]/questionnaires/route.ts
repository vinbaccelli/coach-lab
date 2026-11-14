import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid } from '@/lib/players/routeKit';
import { validateQuestionnaire } from '@/lib/players/mental';
import { isYmd } from '@/lib/players/nutrition';
import { ASSIGN_COLS, PQ_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/**
 * Send a questionnaire to the player, or start an assessment of the player. From a template
 * (`template_id`, built-in or own) or given here. The questions are copied. With `add_to_todo`, a
 * questionnaire also lands in the player's to-do (due on `due_on`). Assessments never reach the player.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: player, error: pe } = await s.supabase.from('players').select('id').eq('id', id).maybeSingle();
  if (pe) return dbError(pe);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let source: unknown = body;
  let template_id: string | null = null;
  if (body?.template_id !== undefined && body.template_id !== null) {
    if (!isUuid(body.template_id)) return NextResponse.json({ error: 'Unknown questionnaire' }, { status: 400 });
    const { data: t, error: te } = await s.supabase.from('questionnaire_templates').select('id,kind,title,description,questions').eq('id', body.template_id).maybeSingle();
    if (te) return dbError(te);
    if (!t) return NextResponse.json({ error: 'Questionnaire not found' }, { status: 404 });
    template_id = t.id;
    source = t;
  }
  const v = validateQuestionnaire(source);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const due_on = isYmd(body?.due_on) ? body.due_on : null;
  const { data: q, error } = await s.supabase.from('player_questionnaires')
    .insert({ coach_id: s.userId, player_id: id, template_id, ...v.value, due_on, status: 'open' }).select(PQ_COLS).single();
  if (error) return dbError(error);
  let assignment = null;
  if (body?.add_to_todo && v.value.kind === 'questionnaire') {
    const a = await s.supabase.from('player_assignments').insert({
      coach_id: s.userId, player_id: id, title: `Answer: ${v.value.title}`.slice(0, 120), description: v.value.description, due_on, questionnaire_id: q.id,
    }).select(ASSIGN_COLS).single();
    if (a.error) return dbError(a.error);
    assignment = a.data;
  }
  return NextResponse.json({ questionnaire: q, assignment });
}
