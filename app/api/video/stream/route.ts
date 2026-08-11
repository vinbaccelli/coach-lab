import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { guardVideoUrl } from '@/lib/security/videoUrlGuard';

/**
 * Same-origin video proxy — so canvas/ML tooling can read the pixels without
 * tainting, and byte-range playback works uniformly.
 *
 * AUTHENTICATED AND HOST-GUARDED. It used to be neither: any caller could pass
 * any `http(s)` URL, which made it an open proxy on a public domain (bandwidth
 * billed to us, the domain usable as an anonymizer) and an SSRF surface into the
 * server's own network. Both holes are closed here — see lib/security/videoUrlGuard.ts
 * for the layered policy and its one documented residual risk.
 */
export async function GET(req: Request) {
  // Layer 1 — only signed-in coaches. This is the layer that removes anonymous
  // abuse entirely; the URL checks below narrow what an authenticated caller can
  // still reach.
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const guard = guardVideoUrl(searchParams.get('url'));
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  const url = guard.url.toString();

  // Browsers request media using byte ranges (especially YouTube/googlevideo URLs).
  // If we don't forward Range + propagate 206/Content-Range, playback often becomes a black screen.
  const range = req.headers.get('range') ?? undefined;

  // FOLLOW REDIRECTS BY HAND, VALIDATING EVERY HOP.
  //
  // `redirect: 'follow'` would let an allowed host bounce us to an internal
  // address with no second check — the classic way past a host allowlist. But we
  // cannot just refuse redirects either: googlevideo routinely 302s, and the
  // caller here is a <video> element that can only consume bytes, not a JSON
  // "please retry elsewhere". So each hop is re-run through the same guard and
  // the final body is streamed exactly as before.
  const MAX_HOPS = 5;
  let current = url;
  let upstream: Response | null = null;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    upstream = await fetch(current, {
      // Some hosts require a UA; we keep it simple.
      headers: {
        'User-Agent': 'AngleMotion/1.0 (+Next.js proxy)',
        ...(range ? { Range: range } : {}),
      },
      redirect: 'manual',
    });
    if (upstream.status < 300 || upstream.status >= 400) break;

    const location = upstream.headers.get('location');
    if (!location) break;
    const nextGuard = guardVideoUrl(new URL(location, current).toString());
    if (!nextGuard.ok) {
      return NextResponse.json(
        { ok: false, error: 'Upstream redirected to a disallowed host' },
        { status: 502 },
      );
    }
    current = nextGuard.url.toString();
    if (hop === MAX_HOPS) {
      return NextResponse.json({ ok: false, error: 'Too many redirects' }, { status: 502 });
    }
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, error: `Upstream fetch failed (${upstream?.status ?? 'no response'})` },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get('content-type') ?? 'video/mp4';
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  // PRIVATE, not public: the response is now tied to an authenticated session, so
  // it must not sit in a shared/CDN cache where another user could receive it.
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('Accept-Ranges', 'bytes');
  if (contentLength) headers.set('Content-Length', contentLength);
  if (contentRange) headers.set('Content-Range', contentRange);

  // Preserve upstream status so the browser sees 206 for range requests.
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
