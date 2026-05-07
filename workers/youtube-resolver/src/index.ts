import { YtdlCore } from '@ybd-project/ytdl-core/serverless';
import type { YTDL_ClientTypes } from '@ybd-project/ytdl-core/serverless';
import vm from 'node:vm';
// Not in package "exports"; use filesystem path so bundlers resolve the real module.
import { Platform } from '../node_modules/@ybd-project/ytdl-core/package/platforms/Platform.js';

/**
 * `getFullInfo()` caches only by video id + hl + gl — not by `clients` / strategy.
 * The first strategy can store a partial result; later strategies would reuse it and never
 * try alternate InnerTube clients. Disabling the in-memory cache avoids that poisoning
 * (important on Workers where the first client often differs from what works locally).
 */
Platform.getShim().cache.disable();

/**
 * Serverless shim wires `polyfills.eval` to Jinter. YouTube's `signatureCipher` decipher + `n`
 * transform expect real JS semantics; Jinter often fails silently (catch → unsigned URL → no playback).
 * Prefer native `eval` when the runtime allows it (`nodejs_compat`), fall back to Jinter.
 */
{
  const shim = Platform.getShim();
  const jinterEval = shim.polyfills.eval.bind(shim.polyfills) as (code: string) => unknown;
  shim.polyfills.eval = (code: string) => {
    try {
      // Prefer Node `vm` (enabled for this compatibility_date + nodejs_compat); then real eval; then Jinter.
      return vm.runInThisContext(code);
    } catch {
      try {
        return (0, eval)(code);
      } catch {
        return jinterEval(code);
      }
    }
  };
  Platform.load(shim);
}

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

/**
 * The serverless build ships a stub `poToken` (empty strings). YouTube often omits usable stream URLs
 * without a real poToken + visitorData. The default build loads `PoToken.mjs` asynchronously — we wire
 * the same generator here once per isolate.
 */
let poTokenHookInstalled = false;
/** Set when PoToken module fails to load (shown only with ?debug=1). */
let poTokenHookError: string | null = null;
async function ensureRealPoTokenGenerator(): Promise<void> {
  if (poTokenHookInstalled) return;
  poTokenHookInstalled = true;
  try {
    const { generatePoToken } = await import(
      '../node_modules/@ybd-project/ytdl-core/package/platforms/Default/PoToken.mjs'
    );
    const shim = Platform.getShim();
    shim.poToken = generatePoToken;
    Platform.load(shim);
  } catch (e: any) {
    poTokenHookError = e?.message ?? String(e);
  }
}

/** Prefer progressive A+V, then any video+audio with URL, then video-only (still playable). */
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

function summarizeFormats(formats: any[]) {
  const list = formats || [];
  const withUrl = list.filter((f) => typeof f?.url === 'string' && isHttpUrl(f.url));
  return { total: list.length, withHttpUrl: withUrl.length };
}

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function pickRawStreamUrl(raw: any[]): {
  url: string;
  itag?: number;
  hasAudio?: boolean;
  mimeType?: string;
} | null {
  const withUrl = raw.filter((f) => typeof f?.url === 'string' && f.url.startsWith('https://'));
  const noManifest = withUrl.filter((f) => !String(f.url).includes('/manifest/'));
  const pool = noManifest.length ? noManifest : withUrl;
  const combined = pool.filter((f) => {
    const m = String(f.mimeType || '');
    return m.includes('video') && m.includes('audio');
  });
  const videoOnly = pool.filter((f) => {
    const m = String(f.mimeType || '');
    return m.includes('video') && !m.includes('audio');
  });
  const pickPool = combined.length ? combined : videoOnly.length ? videoOnly : pool;
  pickPool.sort(
    (a, b) =>
      (Number(b.height || 0) - Number(a.height || 0)) ||
      (Number(b.bitrate || 0) - Number(a.bitrate || 0)),
  );
  const best = pickPool[0];
  if (!best?.url) return null;
  const mime = String(best.mimeType || '');
  return {
    url: best.url,
    itag: best.itag,
    hasAudio: mime.includes('audio'),
    mimeType: best.mimeType,
  };
}

/**
 * YouTube often blocks InnerTube POSTs from datacenter IPs (incl. Cloudflare Workers).
 * The public watch/embed HTML still embeds `ytInitialPlayerResponse` with `streamingData` often
 * containing plain `https://googlevideo...` URLs (or ciphered streams we decipher like elsewhere).
 */
async function resolveViaWatchPageHtml(targetUrl: string): Promise<{
  directUrl: string;
  title: string | null;
  fmt: any;
} | null> {
  const id = YtdlCore.getVideoID(targetUrl);
  if (!id) return null;

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    // Reduce "consent wall" HTML that omits `ytInitialPlayerResponse.streamingData`.
    Cookie: 'CONSENT=YES+571; SOCS=CAE%3D',
  };

  const pageUrls = [
    `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en&gl=US&has_verified=1`,
    `https://m.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en&gl=US`,
    `https://www.youtube.com/embed/${encodeURIComponent(id)}?hl=en`,
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?hl=en`,
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(280);

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

    const deciphered = await YtdlCore.decipherFormats(raw, GITHUB_PLAYER);
    const list = deciphered && typeof deciphered === 'object' ? Object.values(deciphered) : [];
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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return json({ ok: true });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/resolve') return json({ ok: false, error: 'Not found' }, { status: 404 });

    const target = (url.searchParams.get('url') || '').trim();
    const debug = url.searchParams.get('debug') === '1';
    if (!target || !isHttpUrl(target) || !isYouTubeUrl(target)) {
      return json({ ok: false, error: 'Missing/invalid YouTube url' }, { status: 400 });
    }

    try {
      const attemptLog: Array<{ strategy: string; error?: string; formats?: ReturnType<typeof summarizeFormats> }> = [];

      /**
       * Run watch-page extraction first (no PoToken import — that path is heavy and can exhaust CPU).
       * InnerTube `getFullInfo` × many strategies is heavy; defer PoToken until we need InnerTube.
       */
      try {
        const wp = await resolveViaWatchPageHtml(target);
        if (wp) {
          const { directUrl, title, fmt } = wp;
          return json({
            ok: true,
            directUrl,
            title,
            chosen: {
              itag: fmt.itag ?? null,
              height: fmt.height ?? null,
              container: fmt.container ?? null,
              mimeType: fmt.mimeType ?? null,
              hasAudio: fmt.hasAudio ?? null,
              source: fmt.source ?? 'watch_page',
            },
          });
        }
      } catch (e: any) {
        if (debug) attemptLog.push({ strategy: 'watch_page_html', error: e?.message ?? String(e) });
      }

      await ensureRealPoTokenGenerator();

      let resolved: { info: any; fmt: any; directUrl: string } | null = null;
      for (const strategy of RESOLVE_STRATEGIES) {
        const label = JSON.stringify(strategy);
        try {
          const ytdl = new YtdlCore(strategy);
          const info = await ytdl.getFullInfo(target);
          const formats = info.formats || [];
          if (debug) attemptLog.push({ strategy: label, formats: summarizeFormats(formats) });
          const fmt = choosePlayable(formats);
          const directUrl = fmt?.url;
          if (directUrl && isHttpUrl(directUrl)) {
            resolved = { info, fmt, directUrl };
            break;
          }
        } catch (e: any) {
          if (debug) attemptLog.push({ strategy: label, error: e?.message ?? String(e) });
        }
      }

      if (!resolved) {
        const body: Record<string, any> = { ok: false, error: 'Could not resolve a direct stream URL' };
        if (debug) {
          body.poTokenHookError = poTokenHookError;
          body.attempts = attemptLog;
        }
        return json(body, { status: 422 });
      }

      const { directUrl, fmt, info } = resolved;
      return json({
        ok: true,
        directUrl,
        title: info?.videoDetails?.title ?? null,
        chosen: {
          itag: fmt.itag ?? null,
          height: fmt.height ?? null,
          container: fmt.container ?? null,
          mimeType: fmt.mimeType ?? null,
          hasAudio: fmt.hasAudio ?? null,
          source: 'innertube',
        },
      });
    } catch (e: any) {
      return json({ ok: false, error: e?.message ?? 'Resolver failed' }, { status: 500 });
    }
  },
};
