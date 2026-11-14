import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { validateLog } from '@/lib/players/workouts';
import { LOG_COLS } from '@/lib/players/workoutCols';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const reviewed = () => NextResponse.json({ error: 'This log was reviewed in the meantime. Reload the page.' }, { status: 409, headers: NO_STORE });

/** The player's own logs can be corrected or removed only until the coach approved them. */
async function ownPendingLog(req: Request, token: string, logId: string) {
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return { fail: r.fail };
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return { fail: NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE }) };
  if (!share.perms.add.workouts) return { fail: notAllowed('workouts') };
  const { data: log } = await db.from('player_workout_logs').select('id,author,status').eq('id', logId).eq('player_id', share.player_id).maybeSingle();
  if (!log) return { fail: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
  if (log.author !== 'link' || log.status === 'approved') return { fail: NextResponse.json({ error: 'Only your logs waiting for review can be changed.' }, { status: 403, headers: NO_STORE }) };
  return { db, share };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string; logId: string }> }) {
  const { token, logId } = await ctx.params;
  const own = await ownPendingLog(req, token, logId);
  if ('fail' in own) return own.fail;
  const { db, share } = own;
  const v = validateLog(await req.json().catch(() => null), new Date().toISOString().slice(0, 10));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  // A corrected log goes back to the coach for review.
  const { data, error } = await db.from('player_workout_logs')
    .update({ ...v.value, status: 'submitted', review_note: null, updated_at: new Date().toISOString() })
    .eq('id', logId).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved').select(LOG_COLS);
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return reviewed();
  return NextResponse.json({ log: data[0] }, { headers: NO_STORE });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ token: string; logId: string }> }) {
  const { token, logId } = await ctx.params;
  const own = await ownPendingLog(req, token, logId);
  if ('fail' in own) return own.fail;
  const { db, share } = own;
  const { data, error } = await db.from('player_workout_logs').delete()
    .eq('id', logId).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved').select('id');
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return reviewed();
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
