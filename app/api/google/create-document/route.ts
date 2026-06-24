import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.googleAccessToken) {
    return NextResponse.json(
      { error: 'Google access token missing — sign out and sign in again to grant Docs scope.' },
      { status: 403 },
    );
  }

  const { title, body }: { title?: string; body?: string } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: session.googleAccessToken });

  const docs = google.docs({ version: 'v1', auth: oauth2 });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const docTitle = title?.trim() || 'AngleMotion — Match report';

  try {
    const created = await docs.documents.create({
      requestBody: { title: docTitle },
    });
    const docId = created.data.documentId;
    if (!docId) throw new Error('No document ID');

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: body } }],
      },
    });

    await drive.permissions.create({
      fileId: docId,
      requestBody: { role: 'writer', type: 'anyone' },
    }).catch(() => {});

    const url = `https://docs.google.com/document/d/${docId}/edit`;
    return NextResponse.json({ documentId: docId, url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Docs API failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
