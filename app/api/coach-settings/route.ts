import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { DEFAULT_TECHNICAL_SHEET_LABELS } from '@/lib/players/technicalSheet';

/**
 * Coach-level settings. Currently: the Technical Sheet template (row labels)
 * applied to NEW players. Updated whenever the coach adds/removes rows on any
 * player's sheet; existing players keep their own rows.
 */

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await session.supabase
    .from('coach_settings')
    .select('technical_sheet_template')
    .eq('coach_id', session.userId)
    .maybeSingle<{ technical_sheet_template: string[] | null }>();

  return NextResponse.json({
    technicalSheetTemplate: data?.technical_sheet_template ?? [...DEFAULT_TECHNICAL_SHEET_LABELS],
  });
}

export async function PUT(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as { technicalSheetTemplate?: string[] };
  const labels = (body.technicalSheetTemplate ?? [])
    .map((l) => (typeof l === 'string' ? l.trim() : ''))
    .filter(Boolean)
    .slice(0, 40);

  const { error } = await session.supabase.from('coach_settings').upsert({
    coach_id: session.userId,
    technical_sheet_template: labels,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'coach_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ technicalSheetTemplate: labels });
}
