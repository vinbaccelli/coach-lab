import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';

export const runtime = 'nodejs';

/**
 * Append a screenshot to a player's Google Doc.
 *
 * Maintains the folder tree:  AngleMotion / Players / <Player Name> / <Doc>
 * The Doc + folder IDs are cached on the player row so every screenshot for a
 * player lands in the same document. Each screenshot is inserted at the TOP of
 * the body with a timestamp; player notes are written when the doc is created.
 *
 * Requires the Google `documents` + `drive.file` OAuth scopes (granted at sign-in).
 */

type DriveClient = ReturnType<typeof google.drive>;

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Find a folder by name under an optional parent, creating it if absent. */
async function findOrCreateFolder(drive: DriveClient, name: string, parentId?: string): Promise<string> {
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const list = await drive.files.list({
    q: `name='${safeName}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`,
    fields: 'files(id,name)',
    pageSize: 1,
  });
  const existing = list.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id',
  });
  if (!created.data.id) throw new Error(`Failed to create folder "${name}"`);
  return created.data.id;
}

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
  const { imageUrl, timestampLabel } = (await req.json()) as { imageUrl?: string; timestampLabel?: string };
  if (!imageUrl?.trim()) return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });

  // Load the player (coach-scoped via RLS on the session client).
  const { data: player, error: playerErr } = await session.supabase
    .from('players')
    .select('id, display_name, notes, google_doc_id, google_folder_id')
    .eq('id', playerId)
    .single<{ id: string; display_name: string; notes: string | null; google_doc_id: string | null; google_folder_id: string | null }>();
  if (playerErr || !player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: session.googleAccessToken });
  const docs = google.docs({ version: 'v1', auth: oauth2 });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  try {
    let docId = player.google_doc_id ?? undefined;

    // Verify the cached doc still exists; otherwise recreate.
    if (docId) {
      const ok = await drive.files.get({ fileId: docId, fields: 'id,trashed' }).then(r => r.data.id && !r.data.trashed).catch(() => false);
      if (!ok) docId = undefined;
    }

    if (!docId) {
      // Build folder tree: AngleMotion / Players / <Name>
      const rootId = await findOrCreateFolder(drive, 'AngleMotion');
      const playersId = await findOrCreateFolder(drive, 'Players', rootId);
      const playerFolderId = await findOrCreateFolder(drive, player.display_name, playersId);

      const created = await docs.documents.create({ requestBody: { title: `${player.display_name} — AngleMotion` } });
      docId = created.data.documentId ?? undefined;
      if (!docId) throw new Error('Failed to create document');

      // Move the new doc into the player's folder.
      await drive.files.update({ fileId: docId, addParents: playerFolderId, fields: 'id' }).catch(() => {});

      // Seed the doc with player notes at the bottom (screenshots prepend above).
      const notes = player.notes?.trim();
      const seed = `${player.display_name}\n${notes ? `Notes: ${notes}\n` : ''}\n`;
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: [{ insertText: { location: { index: 1 }, text: seed } }] },
      });

      // Persist IDs on the player row for reuse.
      await session.supabase.from('players')
        .update({ google_doc_id: docId, google_folder_id: playerFolderId })
        .eq('id', playerId);
    }

    // Prepend the screenshot + timestamp at the very top of the body.
    // Requests apply sequentially; inserting image then text at index 1 leaves
    // order top→down: timestamp, image.
    const stamp = timestampLabel?.trim() || new Date().toLocaleString();
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          { insertText: { location: { index: 1 }, text: '\n' } },
          { insertInlineImage: { location: { index: 1 }, uri: imageUrl, objectSize: { width: { magnitude: 450, unit: 'PT' }, height: { magnitude: 253, unit: 'PT' } } } },
          { insertText: { location: { index: 1 }, text: `${stamp}\n` } },
        ],
      },
    });

    return NextResponse.json({ documentId: docId, url: `https://docs.google.com/document/d/${docId}/edit` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Google Docs export failed';
    console.error('[google-doc] Docs export failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
