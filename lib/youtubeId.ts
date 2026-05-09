/**
 * Extract YouTube video ID from common URL shapes (watch, embed, shorts, youtu.be).
 */
export function extractYoutubeVideoId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./i, '');

    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }

    if (!host.includes('youtube.com')) return null;

    const path = u.pathname;
    if (path.startsWith('/shorts/')) {
      const id = path.slice('/shorts/'.length).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (path.startsWith('/embed/')) {
      const id = path.slice('/embed/'.length).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (path.startsWith('/live/')) {
      const id = path.slice('/live/'.length).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }

    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;

    return null;
  } catch {
    return null;
  }
}
