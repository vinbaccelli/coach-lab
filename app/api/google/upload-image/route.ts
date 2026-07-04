import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { getRouteSession } from '@/lib/auth/routeSession';
import { findOrCreateFolder } from '@/lib/google/drive';

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

  const { dataUrl, name } = (await req.json()) as { dataUrl?: string; name?: string };
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
    const rootId = await findOrCreateFolder(drive, 'AngleMotion');
    const folderId = await findOrCreateFolder(drive, 'Screenshots', rootId);

    const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'img';
    const created = await drive.files.create({
      requestBody: {
        name: name?.trim() || `anglemotion-${Date.now()}.${ext}`,
        parents: [folderId],
      },
      media: { mimeType: mime, body: Readable.from(buffer) },
      fields: 'id',
    });
    const fileId = created.data.id;
    if (!fileId) throw new Error('Drive upload failed');

    // Docs' insertInlineImage fetches the URI server-side → needs link access.
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    return NextResponse.json({
      fileId,
      url: `https://drive.google.com/uc?export=view&id=${fileId}`,
      webViewUrl: `https://drive.google.com/file/d/${fileId}/view`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Drive upload failed';
    console.error('[google/upload-image] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
