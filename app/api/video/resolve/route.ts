import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { guardVideoUrl } from '@/lib/security/videoUrlGuard';

/**
 * Resolve a pasted URL to something the player can stream.
 *
 * AUTHENTICATED AND HOST-GUARDED for the same reason as /api/video/stream: it
 * used to accept any `http(s)` string from anyone. It does not fetch the URL
 * itself, but it hands back a `/api/video/stream` path built from it, so letting
 * an unvalidated URL through here just moves the problem one hop. Both routes run
 * the same guard — see lib/security/videoUrlGuard.ts.
 */
export async function GET(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const guard = guardVideoUrl(searchParams.get('url'));
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  const url = guard.url.toString();

  // Fast path: direct video file URL
  if (url.match(/\.(mp4|webm|mov)(\?.*)?$/i)) {
    return NextResponse.json({
      ok: true,
      kind: 'direct',
      streamPath: `/api/video/stream?url=${encodeURIComponent(url)}`,
      title: null,
    });
  }

  // NOTE: We intentionally do NOT attempt server-side yt-dlp in Vercel/edge/serverless,
  // because it requires a binary that isn't available in the deployment environment.
  // Use client-side players (e.g. YouTube via iframe) for non-direct URLs.
  return NextResponse.json(
    { ok: false, error: 'Non-direct URLs must be loaded client-side (embed).' },
    { status: 422 },
  );
}
