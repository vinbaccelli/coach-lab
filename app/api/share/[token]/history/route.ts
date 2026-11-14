import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import { parseCursor, parseFilter, sectionsForLink } from '@/lib/players/history';
import { loadHistory } from '@/lib/players/historySources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

/**
 * The player's timeline through the share link: only the sections the link may see (reports,
 * draft and archived plans, and archived trackers are never sent), same paging and filters as the
 * coach's.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 30));
  const out = await loadHistory(db, {
    viewer: 'link', playerId: share.player_id, filter: parseFilter(sp), cursor: parseCursor(sp.get('before')), limit,
    sections: sectionsForLink(share.perms),
  });
  if (out.error) return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
  return NextResponse.json(out, { headers: NO_STORE });
}
