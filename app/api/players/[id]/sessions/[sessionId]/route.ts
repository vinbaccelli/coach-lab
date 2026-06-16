import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { deleteSessionAssets } from '@/lib/sessions/serverStorage';
import { updateSessionPatch } from '@/lib/sessions/db';
import { rowToPlayerSession } from '@/lib/sessions/types';
import type { SessionArtifact, UpdateSessionRequest } from '@/lib/sessions/types';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: playerId, sessionId } = await ctx.params;

  const { data, error } = await session.supabase
    .from('player_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('player_id', playerId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ session: rowToPlayerSession(data) });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: playerId, sessionId } = await ctx.params;

  const { data: existing, error: fe } = await session.supabase
    .from('player_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('player_id', playerId)
    .single();

  if (fe || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json()) as UpdateSessionRequest;
  const patch = updateSessionPatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('player_sessions')
    .update(patch)
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: rowToPlayerSession(data) });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: playerId, sessionId } = await ctx.params;

  const { data: existing, error: fe } = await session.supabase
    .from('player_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('player_id', playerId)
    .single();

  if (fe || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const artifacts = (existing.artifacts ?? []) as SessionArtifact[];
  try {
    await deleteSessionAssets(
      session.supabase,
      artifacts.map((a) => a.storagePath).filter(Boolean),
    );
  } catch {
    /* storage cleanup best-effort */
  }

  const { error } = await session.supabase
    .from('player_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
