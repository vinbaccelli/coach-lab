import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateQuestionnaire } from '@/lib/players/mental';
import { QT_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

const notYours = () => NextResponse.json({ error: 'Only your own questionnaires can be changed.' }, { status: 404 });

/** Edit one of the coach's own templates. What was already sent keeps its own copy of the questions. */
export async function PATCH(req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { templateId } = await ctx.params;
  const v = validateQuestionnaire(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await s.supabase.from('questionnaire_templates').update({ ...v.value, updated_at: new Date().toISOString() })
    .eq('id', templateId).eq('coach_id', s.userId).select(QT_COLS);
  if (error) return dbError(error);
  if (!data?.length) return notYours();
  return NextResponse.json({ template: data[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { templateId } = await ctx.params;
  const { data, error } = await s.supabase.from('questionnaire_templates').delete().eq('id', templateId).eq('coach_id', s.userId).select('id');
  if (error) return dbError(error);
  if (!data?.length) return notYours();
  return NextResponse.json({ ok: true });
}
