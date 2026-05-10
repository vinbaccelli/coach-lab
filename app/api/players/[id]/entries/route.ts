import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: playerId } = await ctx.params;

  const body = (await req.json()) as {
    category: 'technique' | 'match';
    folder_label: string;
    body_text?: string;
    youtube_url?: string | null;
    opponent_name?: string | null;
    match_date?: string | null;
    screenshots?: string[];
    source?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.category || !body.folder_label?.trim()) {
    return NextResponse.json({ error: 'category and folder_label are required' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('player_entries')
    .insert({
      coach_id: session.userId,
      player_id: playerId,
      category: body.category,
      folder_label: body.folder_label.trim(),
      body_text: body.body_text ?? '',
      youtube_url: body.youtube_url ?? null,
      opponent_name: body.opponent_name ?? null,
      match_date: body.match_date ?? null,
      screenshots: body.screenshots ?? [],
      source: body.source ?? 'app',
      metadata: body.metadata ?? {},
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}
