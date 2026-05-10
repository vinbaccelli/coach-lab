import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

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
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ player: data });
}
