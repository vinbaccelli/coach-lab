import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { validateMetricInput } from '@/lib/players/metrics';

/** Tracked metrics for one player. RLS (own coach) is the access rule; writes also need the `players` feature. */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { data, error } = await session.supabase
    .from('player_metrics')
    .select('id,name,unit,value,recorded_on,note')
    .eq('player_id', id)
    .order('recorded_on', { ascending: true })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metrics: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'players');
  if (denied) return denied;
  const { id } = await ctx.params;
  const v = validateMetricInput(await req.json().catch(() => null), new Date().toISOString().slice(0, 10));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await session.supabase
    .from('player_metrics')
    .insert({ coach_id: session.userId, player_id: id, ...v.input })
    .select('id,name,unit,value,recorded_on,note')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metric: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const pointId = new URL(req.url).searchParams.get('pointId');
  if (!pointId) return NextResponse.json({ error: 'pointId is required' }, { status: 400 });
  const { error } = await session.supabase.from('player_metrics').delete().eq('id', pointId).eq('player_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
