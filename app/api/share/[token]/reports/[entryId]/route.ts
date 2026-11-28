import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One MATCH report of the link's own player, read-only. A link sees it only when it may see the Technical section; technical analysis
 * entries (the coach's notes and annotated screenshots) are never sent through a link, and neither is another player's entry.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  const gone = () => NextResponse.json({ error: 'This report is not available.' }, { status: 404, headers: NO_STORE });
  if (!share.perms.see.technical || !UUID.test(entryId)) return gone();
  const { data, error } = await db
    .from('player_entries')
    .select('id,category,folder_label,body_text,youtube_url,opponent_name,match_date,screenshots,source,metadata,created_at')
    .eq('id', entryId)
    .eq('player_id', share.player_id)
    .eq('category', 'match')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
  if (!data) return gone();
  const { data: player } = await db.from('players').select('display_name').eq('id', share.player_id).maybeSingle<{ display_name: string | null }>();
  return NextResponse.json({ entry: data, playerName: player?.display_name ?? '' }, { headers: NO_STORE });
}
