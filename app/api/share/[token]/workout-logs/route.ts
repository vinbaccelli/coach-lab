import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { linkUnderHourlyLimit } from '@/lib/players/shareBrake';
import { validateLog } from '@/lib/players/workouts';
import { LOG_COLS } from '@/lib/players/workoutCols';
import { isMissingTable } from '@/lib/db/missingTable';
import { isUuid } from '@/lib/players/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * The player logs a workout through the share link: for one of their planned workouts (one log
 * each) or on its own. A "can add" link with the Workouts permission, a valid log, the hourly brake,
 * `client_ref` against retries. The log waits for the coach's review; the plan is never changed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  if (!share.perms.add.workouts) return notAllowed('workouts');
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateLog(body, new Date().toISOString().slice(0, 10));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  const client_ref = isUuid(body?.client_ref) ? body.client_ref : null;
  const existing = async () => (client_ref
    ? (await db.from('player_workout_logs').select(LOG_COLS).eq('player_id', share.player_id).eq('client_ref', client_ref).maybeSingle()).data
    : null);
  const before = await existing();
  if (before) return NextResponse.json({ log: before, duplicate: true }, { headers: NO_STORE });
  let workout_id: string | null = null;
  if (body?.workout_id !== undefined && body.workout_id !== null) {
    if (!isUuid(body.workout_id)) return NextResponse.json({ error: 'Unknown workout' }, { status: 400, headers: NO_STORE });
    const { data: w, error: we } = await db.from('player_workouts').select('id').eq('id', body.workout_id).eq('player_id', share.player_id).maybeSingle();
    if (we) return isMissingTable(we) ? NextResponse.json({ error: 'Not available yet.' }, { status: 503, headers: NO_STORE }) : NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
    if (!w) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    workout_id = w.id;
  }
  if (!(await linkUnderHourlyLimit(db, share))) {
    return NextResponse.json({ error: 'Too many additions in the last hour. Try again later.' }, { status: 429, headers: NO_STORE });
  }
  const { data, error } = await db.from('player_workout_logs').insert({
    coach_id: share.coach_id, player_id: share.player_id, workout_id, ...v.value, author: 'link', status: 'submitted', client_ref,
  }).select(LOG_COLS).single();
  if (error?.code === '23505') {
    const dup = await existing();
    if (dup) return NextResponse.json({ log: dup, duplicate: true }, { headers: NO_STORE });
    return NextResponse.json({ error: 'This workout already has a log.' }, { status: 409, headers: NO_STORE });
  }
  if (error) return isMissingTable(error) ? NextResponse.json({ error: 'Not available yet.' }, { status: 503, headers: NO_STORE }) : NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ log: data }, { headers: NO_STORE });
}
