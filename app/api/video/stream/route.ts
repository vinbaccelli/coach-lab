import { NextResponse } from 'next/server';

function isHttpUrl(u: string) {
  return u.startsWith('http://') || u.startsWith('https://');
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url')?.trim() ?? '';
  if (!url || !isHttpUrl(url)) {
    return NextResponse.json({ ok: false, error: 'Missing/invalid url' }, { status: 400 });
  }

  // Proxy the bytes so the video is same-origin (un-taints canvas/ML usage) and works uniformly.
  const upstream = await fetch(url, {
    // Some hosts require a UA; we keep it simple.
    headers: {
      'User-Agent': 'CoachLab/1.0 (+Next.js proxy)',
    },
    redirect: 'follow',
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, error: `Upstream fetch failed (${upstream.status})` },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get('content-type') ?? 'video/mp4';
  const contentLength = upstream.headers.get('content-length');

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('Accept-Ranges', 'bytes');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new NextResponse(upstream.body, { status: 200, headers });
}

