import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import {
  ensurePlayerDoc,
  insertSessionAtTop,
  isGoogleQuotaError,
  type PlayerDocRow,
} from '@/lib/google/playerDocs';

/**
 * Whether the Match Analysis doc was actually updated.
 *
 * The entry save and the Docs write are separate outcomes, and they used to be
 * collapsed into one 200: a missing Google grant skipped the doc silently, and a
 * Docs failure was caught and logged SERVER-SIDE ONLY. The caller was told
 * "saved" either way, so a report that never reached Google looked identical to
 * one that did. Reporting the doc outcome alongside the entry keeps the rule
 * that a Docs problem must never fail the save, without hiding it.
 */
export type EntryDocStatus = { ok: true; documentId: string } | { ok: false; reason: string };

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
    /**
     * Pre-structured Docs sections (heading / lines / notes / one image each).
     *
     * ADDITIVE: callers that don't send this keep the previous behaviour exactly
     * — sections are derived from `screenshots`. The match decoder's 6-section
     * report needs headings and bullet lines, which the screenshots-only shape
     * cannot express, and `insertSessionAtTop` already accepts this structure.
     */
    sections?: Array<{ heading?: string; imageUrl?: string; lines?: string[]; notes?: string }>;
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
  // never fail the entry save — but it IS reported back, see EntryDocStatus.
  let doc: EntryDocStatus | undefined;

  if (body.category === 'match') {
    if (!session.googleAccessToken) {
      // Same actionable wording as the screenshot route: a session created
      // without the Docs/Drive grant needs a fresh sign-in, and "nothing
      // happened" gives the coach no way to work that out.
      console.error('[entries] No Google access token in session — user must sign out/in to grant scopes.');
      doc = {
        ok: false,
        reason: 'Google access not granted — sign out and sign in again to enable Docs export.',
      };
    } else {
      try {
        const { data: player } = await session.supabase
          .from('players')
          .select('id, display_name, google_doc_id, google_match_doc_id')
          .eq('id', playerId)
          .single<PlayerDocRow>();
        if (!player) {
          doc = { ok: false, reason: 'Player not found for the Google Doc update.' };
        } else {
          const oauth2 = new google.auth.OAuth2();
          oauth2.setCredentials({ access_token: session.googleAccessToken });
          const docs = google.docs({ version: 'v1', auth: oauth2 });
          const drive = google.drive({ version: 'v3', auth: oauth2 });
          const docId = await ensurePlayerDoc(docs, drive, session.supabase, player, 'match');
          await insertSessionAtTop(docs, docId, {
            title: body.folder_label.trim(),
            sections: body.sections?.length
              ? body.sections
              : (body.screenshots ?? []).map((url) => ({ imageUrl: url })),
            youtubeUrl: body.youtube_url ?? undefined,
            notes: body.body_text?.trim() || undefined,
          });
          doc = { ok: true, documentId: docId };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Google Docs update failed';
        console.error('[entries] match doc update failed:', msg);
        doc = {
          ok: false,
          // Docs/Sheets/Slides count against the 15GB account quota, so a full
          // Drive blocks the write itself. Naming that beats a raw API message.
          reason: isGoogleQuotaError(e)
            ? 'Your Google Drive is full — free up space (empty Drive Trash, and check Gmail and Google Photos, which share the same storage) and try again.'
            : msg,
        };
      }
    }
  }

  return NextResponse.json(doc ? { entry: data, doc } : { entry: data });
}
