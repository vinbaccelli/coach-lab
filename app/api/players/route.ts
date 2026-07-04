import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { defaultTechnicalSheet } from '@/lib/players/technicalSheet';

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await session.supabase
    .from('players')
    .select('*')
    .order('display_name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ players: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as {
    display_name?: string;
    photo_url?: string | null;
    date_of_birth?: string | null;
    nationality?: string | null;
    playing_hand?: string | null;
    notes?: string | null;
  };

  if (!body.display_name?.trim()) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
  }

  // New players start with the coach's Technical Sheet template (or the
  // built-in defaults). Existing players are never touched by template changes.
  const { data: settings } = await session.supabase
    .from('coach_settings')
    .select('technical_sheet_template')
    .eq('coach_id', session.userId)
    .maybeSingle<{ technical_sheet_template: string[] | null }>();

  const { data, error } = await session.supabase
    .from('players')
    .insert({
      coach_id: session.userId,
      display_name: body.display_name.trim(),
      photo_url: body.photo_url ?? null,
      date_of_birth: body.date_of_birth ?? null,
      nationality: body.nationality ?? null,
      playing_hand: body.playing_hand ?? 'unknown',
      notes: body.notes ?? null,
      technical_sheet: defaultTechnicalSheet(settings?.technical_sheet_template ?? undefined),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ player: data });
}
