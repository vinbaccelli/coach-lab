import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { getRouteSession } from '@/lib/auth/routeSession';
import { findOrCreateFolder, playerFolderChain } from '@/lib/google/drive';

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
    let folderId: string | null = providedFolderId ?? null;
    if (!folderId && playerId) {
      const { data: player } = await session.supabase
        .from('players')
        .select('id, display_name')
        .eq('id', playerId)
        .single<{ id: string; display_name: string }>();
      if (player?.display_name) {
        try {
          const playerFolder = await playerFolderChain(drive, player.display_name);
          folderId = await findOrCreateFolder(drive, 'Screenshots', playerFolder);
          // Surfaced as the "Open Drive folder" link in PlayerProfileClient.
          await session.supabase
            .from('players')
            .update({ google_folder_id: playerFolder })
            .eq('id', player.id);
        } catch (e) {
          console.error('[google/upload-image] player folder failed, using shared:', e instanceof Error ? e.message : e);
        }
      }
    }
    if (!folderId) {
      // Best-effort. findOrCreateFolder SEARCHES Drive, and the app holds the
      // per-file `drive.file` scope, so it cannot see folders it did not create
      // and can 403 outright on restricted accounts. Falling back to `null`
      // uploads to the user's Drive root — a location they always own — which
      // beats losing the screenshot over a folder we could not resolve.
      try {
        const rootId = await findOrCreateFolder(drive, 'AngleMotion');
        folderId = await findOrCreateFolder(drive, 'Screenshots', rootId);
      } catch (e) {
        console.error('[google/upload-image] shared folder failed, using Drive root:', e instanceof Error ? e.message : e);
        folderId = null;
      }
    }

    const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'img';
    const created = await drive.files.create({
      requestBody: {
        name: name?.trim() || `anglemotion-${Date.now()}.${ext}`,
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: { mimeType: mime, body: Readable.from(buffer) },
      fields: 'id',
    });
    const fileId = created.data.id;
    if (!fileId) throw new Error('Drive upload failed');

    // Docs' insertInlineImage fetches the URI SERVER-SIDE, so the file has to be
    // readable without a session. Workspace domains frequently forbid
    // anyone-with-link sharing and answer "The caller does not have permission"
    // here. That is not recoverable for a Drive-hosted image, so fail loudly and
    // let the caller fall back to Supabase storage, whose signed URL Google can
    // actually fetch — rather than returning a Drive link that silently breaks
    // the Docs insert later.
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[google/upload-image] permissions.create(anyone) failed — Drive image would not be fetchable by Docs:', msg);
      throw new Error(`permissions.create(anyone): ${msg}`);
    }

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
