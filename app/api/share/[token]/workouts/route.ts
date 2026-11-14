import { NextResponse } from 'next/server';
import { resolveShare, type Db, type Share } from '@/lib/players/shareAccess';
import { LOG_COLS, WORKOUT_COLS } from '@/lib/players/workoutCols';
import { workoutRange } from '@/lib/players/workoutRange';
import { isMissingTable } from '@/lib/db/missingTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

/** The player's planned workouts and logs through the share link (only when it may see Workouts). */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (!share.perms.see.workouts) return NextResponse.json({ error: 'This link does not show workouts.' }, { status: 403, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const range = workoutRange(sp.get('from'), sp.get('to'), new Date().toISOString().slice(0, 10));
  const [planned, logs, toFix] = await Promise.all([
    db.from('player_workouts').select(WORKOUT_COLS).eq('player_id', share.player_id).gte('scheduled_on', range.from).lte('scheduled_on', range.to)
      .order('scheduled_on', { ascending: true }).order('created_at', { ascending: true }).limit(500),
    db.from('player_workout_logs').select(LOG_COLS).eq('player_id', share.player_id).gte('performed_on', range.from).lte('performed_on', range.to)
      .order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
    db.from('player_workout_logs').select(LOG_COLS).eq('player_id', share.player_id).eq('author', 'link').eq('status', 'needs_revision').limit(50),
  ]);
  const err = planned.error ?? logs.error;
  if (err) {
    if (isMissingTable(err)) return NextResponse.json({ available: false, workouts: [], logs: [], toFix: [], range, canLog: false }, { headers: NO_STORE });
    return NextResponse.json({ error: 'Could not load' }, { status: 500, headers: NO_STORE });
  }
  const have = new Set((logs.data ?? []).map((l) => l.id));
  const extra = (toFix.data ?? []).filter((l) => !have.has(l.id));
  return NextResponse.json({
    available: true, workouts: planned.data ?? [], logs: [...(logs.data ?? []), ...extra], toFix: toFix.data ?? [], range,
    canLog: share.mode === 'edit' && share.perms.add.workouts,
  }, { headers: NO_STORE });
}
