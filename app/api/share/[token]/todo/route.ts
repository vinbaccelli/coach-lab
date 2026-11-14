import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import { shiftDay } from '@/lib/players/nutrition';
import { ASSIGN_COLS } from '@/lib/players/mentalDb';
import { isMissingTable } from '@/lib/db/missingTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

/** The player's to-do through the share link: open tasks and what was done in the last 14 days. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  const since = `${shiftDay(new Date().toISOString().slice(0, 10), -14)}T00:00:00Z`;
  const [open, done] = await Promise.all([
    db.from('player_assignments').select(ASSIGN_COLS).eq('player_id', share.player_id).eq('status', 'open').order('due_on', { ascending: true }).limit(200),
    db.from('player_assignments').select(ASSIGN_COLS).eq('player_id', share.player_id).eq('status', 'done').gte('done_at', since).order('done_at', { ascending: false }).limit(50),
  ]);
  const err = open.error ?? done.error;
  if (err) {
    if (isMissingTable(err)) return NextResponse.json({ available: false, assignments: [], canComplete: false }, { headers: NO_STORE });
    return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ available: true, assignments: [...(open.data ?? []), ...(done.data ?? [])], canComplete: share.mode === 'edit' }, { headers: NO_STORE });
}
