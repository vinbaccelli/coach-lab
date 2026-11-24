import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { linkUnderHourlyLimit } from '@/lib/players/shareBrake';
import { addKindForCategory } from '@/lib/players/sharePermissions';
import { validateEntry, type TrackerField, type TrackerMode } from '@/lib/players/trackers';
import { isMissingTable } from '@/lib/db/missingTable';
import { isUuid } from '@/lib/players/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTRY_COLS = 'id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at';
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * The player adds an entry to one of their trackers through the share link (no login).
 * Server-side checks: a "can add" link, the add permission of the tracker's section, the tracker
 * belongs to the link's player and is not archived, the entry is valid for the tracker, the hourly
 * brake, and `client_ref` so a retry cannot add it twice. The entry waits for the coach's review.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isUuid(body?.tracker_id)) return NextResponse.json({ error: 'tracker_id is required' }, { status: 400, headers: NO_STORE });

  const { data: tracker, error: te } = await db.from('player_trackers').select('id,player_id,category,mode,fields,archived_at')
    .eq('id', body.tracker_id).eq('player_id', share.player_id).maybeSingle();
  if (te) return isMissingTable(te) ? NextResponse.json({ error: 'Not available yet.' }, { status: 503, headers: NO_STORE }) : NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  if (!tracker || tracker.archived_at) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const kind = addKindForCategory(tracker.category as string);
  if (!kind || !share.perms.add[kind]) return notAllowed('entries here');

  const v = validateEntry({ mode: tracker.mode as TrackerMode, fields: tracker.fields as TrackerField[] }, body, new Date().toISOString().slice(0, 10));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  const client_ref = isUuid(body.client_ref) ? body.client_ref : null;
  if (client_ref) {
    const { data: existing } = await db.from('player_tracker_entries').select(ENTRY_COLS).eq('tracker_id', tracker.id).eq('client_ref', client_ref).maybeSingle();
    if (existing) return NextResponse.json({ entry: existing, duplicate: true }, { headers: NO_STORE });
  }
  if (!(await linkUnderHourlyLimit(db, share))) {
    return NextResponse.json({ error: 'Too many additions in the last hour. Try again later.' }, { status: 429, headers: NO_STORE });
  }
  const { data, error } = await db.from('player_tracker_entries').insert({
    coach_id: share.coach_id, player_id: share.player_id, tracker_id: tracker.id, ...v.value,
    author: 'link', status: 'submitted', client_ref,
  }).select(ENTRY_COLS).single();
  if (error && error.code === '23505' && client_ref) {
    const { data: existing } = await db.from('player_tracker_entries').select(ENTRY_COLS).eq('tracker_id', tracker.id).eq('client_ref', client_ref).maybeSingle();
    if (existing) return NextResponse.json({ entry: existing, duplicate: true }, { headers: NO_STORE });
  }
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ entry: data }, { headers: NO_STORE });
}
