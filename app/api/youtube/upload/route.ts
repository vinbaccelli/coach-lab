import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { getRouteSession } from '@/lib/auth/routeSession';
import { getYouTubeAccessToken } from '@/lib/youtube/connection';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  // The Supabase session still identifies the coach — but it no longer supplies
  // the token. Its Google grant covers documents + drive.file, and Google refuses
  // to issue youtube.upload alongside those, so the YouTube credential lives in
  // its own store (lib/youtube/connection.ts) from its own consent.
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accessToken = await getYouTubeAccessToken(session.userId);
  if (!accessToken) {
    // `needsConnect` distinguishes "you have never connected YouTube" (or the
    // grant was revoked) from a genuine upload failure, so the UI can offer the
    // connect popup instead of an error the coach cannot act on.
    return NextResponse.json(
      { error: 'YouTube not connected', needsConnect: true },
      { status: 403 },
    );
  }

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get('video') as File | null;
  const title = (form.get('title') as string) || 'AngleMotion analysis';

  if (!file) return NextResponse.json({ error: 'Missing video file' }, { status: 400 });

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });

  const buf = Buffer.from(await file.arrayBuffer());
  const stream = Readable.from(buf);

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description: 'Uploaded from AngleMotion',
          categoryId: '17',
        },
        status: {
          privacyStatus: 'unlisted',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        mimeType: file.type || 'video/mp4',
        body: stream,
      },
    });

    const id = res.data.id;
    const url = id ? `https://www.youtube.com/watch?v=${id}` : '';
    return NextResponse.json({ videoId: id, url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'YouTube upload failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
