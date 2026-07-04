import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { ensurePlayerDoc, insertSessionAtTop, type PlayerDocRow } from '@/lib/google/playerDocs';

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

  // Match reports also land in the player's Match Analysis doc (standard
  // two-doc layout, newest session first). Best-effort: a Docs failure must
  // never fail the entry save.
  if (body.category === 'match' && session.googleAccessToken) {
    try {
      const { data: player } = await session.supabase
        .from('players')
        .select('id, display_name, google_doc_id, google_match_doc_id')
        .eq('id', playerId)
        .single<PlayerDocRow>();
      if (player) {
        const oauth2 = new google.auth.OAuth2();
        oauth2.setCredentials({ access_token: session.googleAccessToken });
        const docs = google.docs({ version: 'v1', auth: oauth2 });
        const drive = google.drive({ version: 'v3', auth: oauth2 });
        const docId = await ensurePlayerDoc(docs, drive, session.supabase, player, 'match');
        await insertSessionAtTop(docs, docId, {
          title: body.folder_label.trim(),
          sections: (body.screenshots ?? []).map((url) => ({ imageUrl: url })),
          youtubeUrl: body.youtube_url ?? undefined,
          notes: body.body_text?.trim() || undefined,
        });
      }
    } catch (e) {
      console.error('[entries] match doc update skipped:', e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ entry: data });
}
