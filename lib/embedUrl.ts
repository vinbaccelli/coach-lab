/**
 * Normalize pasted URLs and resolve platform-specific embed targets for iframe preview.
 */

import { extractYoutubeVideoId } from '@/lib/youtubeId';

export type EmbedResolve =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'iframe'; src: string; platform: string };

export function normalizeWebUrlInput(raw: string): string {
  let s = raw.trim().replace(/[\u200b-\u200d\ufeff]/g, '');
  if (!/^https?:\/\//i.test(s)) {
    if (/^[\w.-]+\.[a-z]{2,}/i.test(s) || /^(www\.|m\.)/i.test(s)) {
      s = `https://${s.replace(/^\/\//, '')}`;
    }
  }
  return s;
}

/** Instagram /p/, /reel/, /tv/ shortcodes */
function extractInstagramEmbedSrc(url: URL): string | null {
  const m = url.pathname.match(/^\/(p|reel|tv)\/([^/]+)/);
  if (!m) return null;
  const shortcode = m[2];
  return `https://www.instagram.com/${m[1]}/${shortcode}/embed`;
}

/** TikTok numeric video id from path /@user/video/123 */
function extractTikTokEmbedSrc(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (!host.includes('tiktok.com')) return null;
  const m = url.pathname.match(/\/video\/(\d+)/);
  if (!m) return null;
  return `https://www.tiktok.com/embed/v2/${m[1]}`;
}

/**
 * Resolve a watch-page URL to either YouTube (native player) or another embed iframe src.
 */
export function resolveEmbedTarget(raw: string): EmbedResolve | null {
  const s = normalizeWebUrlInput(raw);
  if (!/^https?:\/\//i.test(s)) return null;

  const yt = extractYoutubeVideoId(s);
  if (yt) return { kind: 'youtube', videoId: yt };

  try {
    const url = new URL(s);
    const ig = extractInstagramEmbedSrc(url);
    if (ig) return { kind: 'iframe', src: ig, platform: 'Instagram' };

    const tt = extractTikTokEmbedSrc(url);
    if (tt) return { kind: 'iframe', src: tt, platform: 'TikTok' };

    // Fallback: allow same-origin-safe URLs as raw iframe (often blocked by X-Frame-Options)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return { kind: 'iframe', src: url.href, platform: 'Web' };
    }
  } catch {
    return null;
  }

  return null;
}
