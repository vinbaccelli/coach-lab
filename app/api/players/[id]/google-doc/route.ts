import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { ensurePlayerDoc, insertSessionAtTop, type PlayerDocRow } from '@/lib/google/playerDocs';

export const runtime = 'nodejs';

/**
 * Append a screenshot to a player's Technical Analysis Google Doc.
 *
 * Standard two-doc layout (lib/google/playerDocs.ts): the doc keeps the
 * player-name header on top and each save is inserted as a session block
 * directly below it — newest first, header never duplicated.
 *
 * Requires the Google `documents` + `drive.file` OAuth scopes (granted at sign-in).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.googleAccessToken) {
    console.error('[google-doc] No Google access token in session — user must sign out/in to grant scopes.');
    return NextResponse.json(
      { error: 'Google access not granted — sign out and sign in again to enable Docs export.' },
      { status: 403 },
    );
  }

  const { id: playerId } = await params;
  const { imageUrl, timestampLabel, notes } = (await req.json()) as {
    imageUrl?: string;
    timestampLabel?: string;
    notes?: string;
  };
  if (!imageUrl?.trim()) return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });

  // Load the player (coach-scoped via RLS on the session client).
  const { data: player } = await session.supabase
    .from('players')
    .select('id, display_name, google_doc_id, google_match_doc_id')
    .eq('id', playerId)
    .single<PlayerDocRow>();
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: session.googleAccessToken });
  const docs = google.docs({ version: 'v1', auth: oauth2 });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  try {
    const docId = await ensurePlayerDoc(docs, drive, session.supabase, player, 'technical');
    await insertSessionAtTop(docs, docId, {
      title: timestampLabel?.trim() ? `Screenshot — ${timestampLabel.trim()}` : undefined,
      sections: [{ imageUrl }],
      notes: notes?.trim() || undefined,
    });

    return NextResponse.json({ documentId: docId, url: `https://docs.google.com/document/d/${docId}/edit` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Google Docs export failed';
    console.error('[google-doc] Docs export failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
