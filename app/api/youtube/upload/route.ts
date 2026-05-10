import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { getRouteSession } from '@/lib/auth/routeSession';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.googleAccessToken) {
    return NextResponse.json(
      { error: 'Google access token missing — sign out and sign in again to grant YouTube scope.' },
      { status: 403 },
    );
  }

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get('video') as File | null;
  const title = (form.get('title') as string) || 'Coach Lab analysis';

  if (!file) return NextResponse.json({ error: 'Missing video file' }, { status: 400 });

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: session.googleAccessToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });

  const buf = Buffer.from(await file.arrayBuffer());
  const stream = Readable.from(buf);

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description: 'Uploaded from Coach Lab',
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
