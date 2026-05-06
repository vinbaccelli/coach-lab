import { YtdlCore } from '@ybd-project/ytdl-core/serverless';

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': '*',
      ...(init?.headers ?? {}),
    },
  });
}

function isHttpUrl(u: string) {
  return u.startsWith('http://') || u.startsWith('https://');
}

function isYouTubeUrl(u: string) {
  return /(^|\.)youtu\.be\//i.test(u) || /youtube\.com\//i.test(u);
}

function pickFormat(formats: any[]) {
  // Prefer MP4 progressive if possible, else highest quality with URL.
  const withUrl = formats.filter((f) => typeof f?.url === 'string' && isHttpUrl(f.url));
  const mp4 = withUrl.filter((f) => f.container === 'mp4' || String(f.mimeType || '').includes('video/mp4'));
  const progressive = mp4.filter((f) => !!f.hasAudio && !!f.hasVideo);
  const sorted = (progressive.length ? progressive : mp4.length ? mp4 : withUrl).sort(
    (a, b) => (Number(b.height || 0) - Number(a.height || 0)) || (Number(b.bitrate || 0) - Number(a.bitrate || 0)),
  );
  return sorted[0];
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return json({ ok: true });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/resolve') return json({ ok: false, error: 'Not found' }, { status: 404 });

    const target = (url.searchParams.get('url') || '').trim();
    if (!target || !isHttpUrl(target) || !isYouTubeUrl(target)) {
      return json({ ok: false, error: 'Missing/invalid YouTube url' }, { status: 400 });
    }

    try {
      const ytdl = new YtdlCore();
      const info = await ytdl.getFullInfo(target);
      const fmt = pickFormat(info.formats || []);
      const directUrl = fmt?.url;
      if (!directUrl || !isHttpUrl(directUrl)) {
        return json({ ok: false, error: 'Could not resolve a direct stream URL' }, { status: 422 });
      }
      return json({
        ok: true,
        directUrl,
        title: info?.videoDetails?.title ?? null,
        chosen: {
          itag: fmt.itag ?? null,
          height: fmt.height ?? null,
          container: fmt.container ?? null,
          mimeType: fmt.mimeType ?? null,
        },
      });
    } catch (e: any) {
      return json({ ok: false, error: e?.message ?? 'Resolver failed' }, { status: 500 });
    }
  },
};

