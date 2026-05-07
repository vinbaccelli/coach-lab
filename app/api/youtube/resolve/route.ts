import { NextResponse } from 'next/server';
import { YtdlCore } from '@ybd-project/ytdl-core';
import type { YTDL_ClientTypes } from '@ybd-project/ytdl-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vercel / long-running Node runtimes; ignored elsewhere. */
export const maxDuration = 60;

function isHttpUrl(u: string) {
  return u.startsWith('http://') || u.startsWith('https://');
}

function pickFallbackFormat(formats: any[]) {
  const list = formats || [];
  const withUrl = list.filter(
    (f) => typeof f?.url === 'string' && isHttpUrl(f.url) && f.hasVideo,
  );
  const progressive = withUrl.filter((f) => f.hasVideo && f.hasAudio && !f.isHLS && !f.isDashMPD);
  const combined = withUrl.filter((f) => f.hasVideo && f.hasAudio);
  const pool = progressive.length ? progressive : combined.length ? combined : withUrl;
  return pool.sort(
    (a, b) =>
      (Number(b.height || parseInt(String(b.quality?.label), 10) || 0) -
        Number(a.height || parseInt(String(a.quality?.label), 10) || 0)) ||
      (Number(b.bitrate || 0) - Number(a.bitrate || 0)),
  )[0];
}

function choosePlayable(formats: any[]): any | undefined {
  if (!formats?.length) return undefined;
  try {
    const fmt = YtdlCore.chooseFormat(formats, {
      quality: 'highest',
      filter: 'audioandvideo',
    });
    if (fmt?.url && isHttpUrl(fmt.url)) return fmt;
  } catch {
    /* no combined format */
  }
  try {
    const fmt = YtdlCore.chooseFormat(formats, {
      quality: 'highestvideo',
      filter: 'videoonly',
    });
    if (fmt?.url && isHttpUrl(fmt.url)) return fmt;
  } catch {
    /* no video-only in filter set */
  }
  return pickFallbackFormat(formats);
}

type Strategy = ConstructorParameters<typeof YtdlCore>[0];

const GITHUB_PLAYER = { useRetrievedFunctionsFromGithub: true } as const;

const RESOLVE_STRATEGIES: Strategy[] = [
  { html5Player: GITHUB_PLAYER },
  {},
  { html5Player: GITHUB_PLAYER, clients: ['android'] satisfies YTDL_ClientTypes[], disableDefaultClients: true },
  { html5Player: GITHUB_PLAYER, clients: ['ios'] satisfies YTDL_ClientTypes[], disableDefaultClients: true },
  { html5Player: GITHUB_PLAYER, clients: ['mweb'] satisfies YTDL_ClientTypes[], disableDefaultClients: true },
  { html5Player: GITHUB_PLAYER, clients: ['tv'] satisfies YTDL_ClientTypes[], disableDefaultClients: true },
  { html5Player: GITHUB_PLAYER, clients: ['tvEmbedded'] satisfies YTDL_ClientTypes[], disableDefaultClients: true },
  { html5Player: GITHUB_PLAYER, clients: ['webEmbedded'] satisfies YTDL_ClientTypes[], disableDefaultClients: true },
];

/**
 * Same-origin YouTube → direct stream URL resolution for the analysis page.
 * Runs on Node (not Edge): `@ybd-project/ytdl-core` needs real JS execution for signature deciphering.
 * Cloudflare Workers cannot reliably run that path (runtime eval limits + broken PoToken/jsdom on Workers).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url')?.trim() ?? '';
  if (!target || !isHttpUrl(target)) {
    return NextResponse.json({ ok: false, error: 'Missing/invalid url' }, { status: 400 });
  }

  const lower = target.toLowerCase();
  if (!lower.includes('youtu.be/') && !lower.includes('youtube.com/')) {
    return NextResponse.json({ ok: false, error: 'Not a YouTube URL' }, { status: 400 });
  }

  let lastErr: string | undefined;
  for (const strategy of RESOLVE_STRATEGIES) {
    try {
      const ytdl = new YtdlCore(strategy);
      const info = await ytdl.getFullInfo(target);
      const fmt = choosePlayable(info.formats || []);
      const directUrl = fmt?.url;
      if (directUrl && isHttpUrl(directUrl)) {
        return NextResponse.json({
          ok: true,
          directUrl,
          title: info.videoDetails?.title ?? null,
          chosen: {
            itag: fmt.itag ?? null,
            height: fmt.height ?? null,
            container: fmt.container ?? null,
            mimeType: fmt.mimeType ?? null,
            hasAudio: fmt.hasAudio ?? null,
            source: 'innertube',
          },
        });
      }
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(
    { ok: false, error: lastErr || 'Could not resolve a direct stream URL' },
    { status: 422 },
  );
}
