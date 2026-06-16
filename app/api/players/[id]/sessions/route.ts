import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { createSessionInsert } from '@/lib/sessions/db';
import { rowToPlayerSession } from '@/lib/sessions/types';
import type { CreateSessionRequest } from '@/lib/sessions/types';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: playerId } = await ctx.params;

  const { data: player, error: pe } = await session.supabase
    .from('players')
    .select('id')
    .eq('id', playerId)
    .single();
  if (pe || !player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const { data, error } = await session.supabase
    .from('player_sessions')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sessions: (data ?? []).map((row) => rowToPlayerSession(row)),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: playerId } = await ctx.params;

  const { data: player, error: pe } = await session.supabase
    .from('players')
    .select('id')
    .eq('id', playerId)
    .single();
  if (pe || !player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const body = (await req.json()) as CreateSessionRequest;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const analysisType = body.analysisType ?? (body.status === 'draft' ? 'other' : undefined);
  if (!analysisType) {
    return NextResponse.json({ error: 'analysisType is required' }, { status: 400 });
  }

  const insert = createSessionInsert(session.userId, playerId, { ...body, analysisType });
  const { data, error } = await session.supabase
    .from('player_sessions')
    .insert(insert)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session: rowToPlayerSession(data) });
}
