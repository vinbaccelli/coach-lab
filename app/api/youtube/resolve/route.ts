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

function isYouTubeUrl(u: string) {
  const lower = u.toLowerCase();
  return lower.includes('youtu.be/') || lower.includes('youtube.com/');
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: '*/*',
};

function makeYtdl(strategy: Strategy) {
  return new YtdlCore({
    ...strategy,
    // Serverless FS can be flaky; reduce reliance on file writes.
    disableFileCache: true,
    disableBasicCache: true,
    // Make requests look less like a bot.
    fetcher: (url: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(BROWSER_HEADERS)) {
        if (!headers.has(k)) headers.set(k, v);
      }
      return fetch(url, { ...init, headers });
    },
  });
}

const RESOLVE_STRATEGIES: Strategy[] = [
  { html5Player: GITHUB_PLAYER },
  {},
  {
    html5Player: GITHUB_PLAYER,
    clients: ['android'] satisfies YTDL_ClientTypes[],
    disableDefaultClients: true,
  },
  {
    html5Player: GITHUB_PLAYER,
    clients: ['ios'] satisfies YTDL_ClientTypes[],
    disableDefaultClients: true,
  },
  {
    html5Player: GITHUB_PLAYER,
    clients: ['mweb'] satisfies YTDL_ClientTypes[],
    disableDefaultClients: true,
  },
  {
    html5Player: GITHUB_PLAYER,
    clients: ['tv'] satisfies YTDL_ClientTypes[],
    disableDefaultClients: true,
  },
  {
    html5Player: GITHUB_PLAYER,
    clients: ['tvEmbedded'] satisfies YTDL_ClientTypes[],
    disableDefaultClients: true,
  },
  {
    html5Player: GITHUB_PLAYER,
    clients: ['webEmbedded'] satisfies YTDL_ClientTypes[],
    disableDefaultClients: true,
  },
];

/** Pull `ytInitialPlayerResponse` JSON from a watch/embed HTML document (string-aware brace match). */
function extractYtInitialPlayerResponse(html: string): any | null {
  const needles = ['var ytInitialPlayerResponse = ', 'ytInitialPlayerResponse = '];
  for (const needle of needles) {
    const pos = html.indexOf(needle);
    if (pos === -1) continue;
    let i = pos + needle.length;
    while (i < html.length && (html[i] === ' ' || html[i] === '\n' || html[i] === '\r')) i++;
    if (html[i] !== '{') continue;
    const jsonStr = extractBalancedJson(html, i);
    if (!jsonStr) continue;
    try {
      return JSON.parse(jsonStr);
    } catch {
      continue;
    }
  }
  return null;
}

function extractBalancedJson(s: string, startIdx: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return null;
}

function pickRawStreamUrl(raw: any[]): {
  url: string;
  itag?: number;
  hasAudio?: boolean;
  mimeType?: string;
} | null {
  const withUrl = raw.filter((f) => typeof f?.url === 'string' && String(f.url).startsWith('https://'));
  const noManifest = withUrl.filter((f) => !String(f.url).includes('/manifest/'));
  const pool = noManifest.length ? noManifest : withUrl;
  pool.sort(
    (a, b) =>
      (Number(b.height || 0) - Number(a.height || 0)) ||
      (Number(b.bitrate || 0) - Number(a.bitrate || 0)),
  );
  const best = pool[0];
  if (!best?.url) return null;
  const mime = String(best.mimeType || '');
  return {
    url: best.url,
    itag: best.itag,
    hasAudio: mime.includes('audio'),
    mimeType: best.mimeType,
  };
}

async function resolveViaWatchPageHtml(targetUrl: string): Promise<{
  directUrl: string;
  title: string | null;
  fmt: any;
} | null> {
  let id: string | null = null;
  try {
    id = YtdlCore.getVideoID(targetUrl);
  } catch {
    id = null;
  }
  if (!id) return null;

  const headers = {
    ...BROWSER_HEADERS,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Cookie: 'CONSENT=YES+571; SOCS=CAE%3D',
  };

  const pageUrls = [
    `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en&gl=US&has_verified=1`,
    `https://m.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en&gl=US`,
    `https://www.youtube.com/embed/${encodeURIComponent(id)}?hl=en`,
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?hl=en`,
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(220);

    let pr: any | null = null;
    for (const pageUrl of pageUrls) {
      const r = await fetch(pageUrl, { redirect: 'follow', headers });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.includes('consent.youtube.com')) continue;
      pr = extractYtInitialPlayerResponse(html);
      if (pr?.streamingData) break;
    }

    if (!pr?.streamingData || !pr.videoDetails) continue;
    const status = pr.playabilityStatus?.status;
    if (status === 'ERROR' || status === 'UNPLAYABLE' || status === 'LOGIN_REQUIRED') continue;

    const raw = [...(pr.streamingData.formats || []), ...(pr.streamingData.adaptiveFormats || [])].filter(Boolean);

    const direct = pickRawStreamUrl(raw);
    if (direct) {
      return {
        directUrl: direct.url,
        title: pr.videoDetails?.title ?? null,
        fmt: {
          itag: direct.itag,
          hasAudio: direct.hasAudio,
          mimeType: direct.mimeType,
          source: 'watch_page',
        },
      };
    }

    // Decipher signatureCipher/n using Node runtime
    const deciphered = await YtdlCore.decipherFormats(raw, GITHUB_PLAYER);
    const list = Array.isArray(deciphered)
      ? deciphered
      : deciphered && typeof deciphered === 'object'
        ? Object.values(deciphered)
        : [];
    const videoFormats = YtdlCore.toVideoFormats(list as any, false);
    const fmt = choosePlayable(videoFormats);
    if (fmt?.url && isHttpUrl(fmt.url)) {
      return {
        directUrl: fmt.url,
        title: pr.videoDetails?.title ?? null,
        fmt: { ...fmt, source: 'watch_page_decipher' },
      };
    }
  }

  return null;
}

/**
 * Same-origin YouTube → direct stream URL resolution for the analysis page.
 * Runs on Node (not Edge): `@ybd-project/ytdl-core` needs real JS execution for signature deciphering.
 * Cloudflare Workers cannot reliably run that path (runtime eval limits + broken PoToken/jsdom on Workers).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url')?.trim() ?? '';
  const debug = searchParams.get('debug') === '1';
  if (!target || !isHttpUrl(target)) {
    return NextResponse.json({ ok: false, error: 'Missing/invalid url' }, { status: 400 });
  }

  if (!isYouTubeUrl(target)) {
    return NextResponse.json({ ok: false, error: 'Not a YouTube URL' }, { status: 400 });
  }

  const attempts: Array<{ stage: string; strategy?: string; error?: string }> = [];

  // Cheapest reliable path first (often works even when InnerTube is blocked).
  try {
    const wp = await resolveViaWatchPageHtml(target);
    if (wp) {
      return NextResponse.json({
        ok: true,
        directUrl: wp.directUrl,
        title: wp.title,
        chosen: {
          itag: wp.fmt?.itag ?? null,
          height: wp.fmt?.height ?? null,
          container: wp.fmt?.container ?? null,
          mimeType: wp.fmt?.mimeType ?? null,
          hasAudio: wp.fmt?.hasAudio ?? null,
          source: wp.fmt?.source ?? 'watch_page',
        },
        ...(debug ? { attempts } : {}),
      });
    }
  } catch (e: unknown) {
    if (debug) attempts.push({ stage: 'watch_page_html', error: e instanceof Error ? e.message : String(e) });
  }

  let lastErr: string | undefined;
  for (const strategy of RESOLVE_STRATEGIES) {
    const label = JSON.stringify(strategy);
    try {
      const ytdl = makeYtdl(strategy);
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
          ...(debug ? { attempts } : {}),
        });
      }
      if (debug) attempts.push({ stage: 'innertube_no_url', strategy: label });
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (debug) attempts.push({ stage: 'innertube_error', strategy: label, error: lastErr });
    }
  }

  return NextResponse.json(
    { ok: false, error: lastErr || 'Could not resolve a direct stream URL', ...(debug ? { attempts } : {}) },
    { status: 422 },
  );
}
