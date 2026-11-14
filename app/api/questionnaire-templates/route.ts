import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateQuestionnaire } from '@/lib/players/mental';
import { QT_COLS } from '@/lib/players/mentalDb';

export const runtime = 'nodejs';

/** Built-in questionnaires and assessments, and the coach's own (RLS decides which). */
export async function GET() {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { data, error } = await s.supabase.from('questionnaire_templates').select(QT_COLS).is('archived_at', null).order('title', { ascending: true }).limit(300);
  if (error) return dbError(error, { templates: [] });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const v = validateQuestionnaire(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await s.supabase.from('questionnaire_templates').insert({ coach_id: s.userId, ...v.value }).select(QT_COLS).single();
  if (error) return dbError(error);
  return NextResponse.json({ template: data });
}
