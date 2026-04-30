import { NextResponse } from 'next/server';
import ytdlp from 'yt-dlp-exec';

function isHttpUrl(u: string) {
  return u.startsWith('http://') || u.startsWith('https://');
}

function safeName(name: string) {
  return name.replace(/[^\w\s.-]+/g, '').trim().slice(0, 120);
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

  // Best-effort universal resolver via yt-dlp (supports YouTube / TikTok / Instagram / many others).
  try {
    // Use stdout JSON so we can extract a direct media URL.
    const info: any = await (ytdlp as any)(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      // Prefer MP4; fall back to whatever is available.
      format: 'bv*+ba/b',
    });

    const directUrl: string | undefined =
      info?.url ||
      info?.requested_formats?.[0]?.url ||
      info?.requested_formats?.[1]?.url;

    if (!directUrl || !isHttpUrl(directUrl)) {
      return NextResponse.json({ ok: false, error: 'Could not resolve a direct media URL' }, { status: 422 });
    }

    const title = typeof info?.title === 'string' ? safeName(info.title) : null;

    return NextResponse.json({
      ok: true,
      kind: 'resolved',
      streamPath: `/api/video/stream?url=${encodeURIComponent(directUrl)}`,
      title,
      originalUrl: url,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Resolver failed' },
      { status: 500 },
    );
  }
}

