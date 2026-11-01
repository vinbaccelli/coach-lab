import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { requireFeature } from '@/lib/entitlements.server';
import { storeScreenshotInDrive, type ScreenshotPlayer } from '@/lib/google/drive';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Upload a screenshot to the COACH'S OWN Google Drive and return a link that
 * Google Docs can embed. This is the V1 "bring your own cloud" storage path:
 * image bytes live in the user's Drive (AngleMotion/Screenshots), not on our
 * infrastructure. Files get anyone-with-link read permission so the Docs API
 * can fetch them for insertInlineImage.
 */
export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeature(session.supabase, { id: session.userId, email: session.email }, 'docsExport');
  if (denied) return denied;
  if (!session.googleAccessToken) {
    return NextResponse.json(
      { error: 'Google access not granted — sign out and sign in again.' },
      { status: 403 },
    );
  }

  const { dataUrl, name, playerId, folderId: providedFolderId } = (await req.json()) as {
    dataUrl?: string;
    name?: string;
    playerId?: string;
    /**
     * A folder id an EARLIER call in the same batch already resolved (see the
     * manual recorder's multi-tile report upload, which resolves once via its
     * first tile and reuses this for the rest). Skips the find-or-create
     * lookup below entirely. Concurrent calls that each resolve the same
     * folder chain from scratch race `findOrCreateFolder`'s check-then-create
     * (see lib/google/drive.ts) — resolving once and passing the id along
     * avoids both the redundant Drive calls and the race. The single-
     * screenshot upload path never sends this, so it keeps resolving its own
     * folder per call exactly as before.
     */
    folderId?: string;
  };
  if (!dataUrl?.startsWith('data:image/')) {
    return NextResponse.json({ error: 'dataUrl (image) is required' }, { status: 400 });
  }

  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return NextResponse.json({ error: 'Invalid data URL' }, { status: 400 });
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: session.googleAccessToken });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  try {
    // File the screenshot under the PLAYER it was saved to — AngleMotion /
    // Players / <Name> / Screenshots — matching where ensurePlayerDoc puts that
    // player's docs. Without a playerId (or if the lookup fails) fall back to
    // the shared AngleMotion / Screenshots folder, which is where every
    // screenshot used to land regardless of player.
    //
    // Skipped entirely when the caller already resolved a folder (see
    // `providedFolderId` above) — reused as-is rather than re-resolved.
    //
    // The Drive work is storeScreenshotInDrive (lib/google/drive.ts): the saved
    // players.google_folder_id is used instead of searching every time, and
    // that id is written in parallel with the upload (KNOWN_ISSUES 071).
    let player: ScreenshotPlayer | null = null;
    if (!providedFolderId && playerId) {
      const { data } = await session.supabase
        .from('players')
        .select('id, display_name, google_folder_id')
        .eq('id', playerId)
        .single<ScreenshotPlayer>();
      player = data ?? null;
    }

    const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'img';
    const { fileId, folderId } = await storeScreenshotInDrive(
      drive,
      { player, providedFolderId, name: name?.trim() || `anglemotion-${Date.now()}.${ext}`, mime, buffer },
      {
        async savePlayerFolderId(id, folder) {
          // Surfaced as the "Open Drive folder" link in PlayerProfileClient.
          const { error } = await session.supabase.from('players').update({ google_folder_id: folder }).eq('id', id);
          if (error) throw new Error(error.message);
        },
        log: (message, detail) => console.error(message, detail),
        timing: (fields) => console.info('[google/upload-image] timing', JSON.stringify(fields)),
        now: () => Date.now(),
      },
    );

    return NextResponse.json({
      fileId,
      url: `https://drive.google.com/uc?export=view&id=${fileId}`,
      webViewUrl: `https://drive.google.com/file/d/${fileId}/view`,
      // The folder this upload actually landed in — resolved fresh, or the
      // caller's own `providedFolderId` echoed back. Lets a caller uploading
      // several files in one batch resolve once and reuse it for the rest.
      ...(folderId ? { folderId } : {}),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Drive upload failed';
    console.error('[google/upload-image] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
