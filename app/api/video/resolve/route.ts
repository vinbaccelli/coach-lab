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

