import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { getYouTubeAccessToken } from '@/lib/youtube/connection';

export const runtime = 'nodejs';

/**
 * Mint a YouTube RESUMABLE UPLOAD SESSION and hand its URL to the browser.
 *
 * WHY THIS EXISTS — the 413.
 * The previous design POSTed the whole recording to /api/youtube/upload as
 * multipart/form-data and the route buffered it with Buffer.from(await
 * file.arrayBuffer()) before piping it to Google. On Vercel a serverless
 * function request body is capped at 4.5 MB, and the platform rejects the
 * request with 413 BEFORE the handler ever runs. A 30-second capture at the
 * 5 Mbps this app encodes at is ~19 MB, so every recording of consequence
 * failed — and because Vercel's 413 body is HTML, the client's res.json()
 * either threw or produced a contentless "upload failed (413)".
 *
 * Now the bytes NEVER touch our infrastructure. This route does the one thing
 * that genuinely needs the server (it holds the YouTube credential) — it
 * creates the upload session and returns the session URL — and the browser
 * PUTs the video straight to Google in chunks (lib/export/youtubeResumableUpload.ts).
 * That removes the body limit, the 300s function ceiling, and the lambda memory
 * cost of holding an entire video, all at once.
 *
 * ON RETURNING THE SESSION URL TO THE CLIENT.
 * The session URL is a capability URL: it carries its own upload authorization,
 * is scoped to this ONE video insert for this coach's channel, and expires
 * (Google documents ~1 week). It is not the access token and confers no other
 * API access — this is the same pattern Google's own browser upload samples
 * use. The access token itself stays server-side and is never sent to the page.
 */
export async function POST(req: Request) {
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

  let body: { title?: string; sizeBytes?: number; mimeType?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const title = body.title?.trim() || 'AngleMotion analysis';
  const mimeType = body.mimeType || 'video/mp4';
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: 'sizeBytes (positive number) is required' }, { status: 400 });
  }

  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        // Declaring both up front lets Google reject an over-quota or
        // unsupported upload HERE, before the browser sends a single byte.
        'X-Upload-Content-Length': String(sizeBytes),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify({
        snippet: { title, description: 'Uploaded from AngleMotion', categoryId: '17' },
        status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
      }),
    },
  );

  if (!init.ok) {
    const detail = await init.text().catch(() => '');
    // 401/403 from Google here means the stored grant is dead (revoked, or the
    // refresh failed) — the same two-click fix as never having connected.
    const needsConnect = init.status === 401 || init.status === 403;
    console.error(`[youtube/upload-session] init failed ${init.status}: ${detail.slice(0, 500)}`);
    return NextResponse.json(
      {
        error: needsConnect
          ? 'YouTube authorization was rejected — reconnect YouTube and try again.'
          : `YouTube refused the upload (${init.status}).`,
        needsConnect,
      },
      { status: needsConnect ? 403 : 502 },
    );
  }

  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) {
    console.error('[youtube/upload-session] init succeeded but returned no Location header');
    return NextResponse.json({ error: 'YouTube did not return an upload URL.' }, { status: 502 });
  }

  return NextResponse.json({ uploadUrl });
}
