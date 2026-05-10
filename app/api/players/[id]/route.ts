import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const { data: player, error: pe } = await session.supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .single();
  if (pe || !player) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: entries, error: ee } = await session.supabase
    .from('player_entries')
    .select('*')
    .eq('player_id', id)
    .order('created_at', { ascending: false });

  if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });

  return NextResponse.json({ player, entries: entries ?? [] });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const body = (await req.json()) as Partial<{
    display_name: string;
    photo_url: string | null;
    date_of_birth: string | null;
    nationality: string | null;
    playing_hand: string | null;
    notes: string | null;
  }>;

  const { data, error } = await session.supabase
    .from('players')
    .update({
      ...body,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ player: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const { error } = await session.supabase.from('players').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
