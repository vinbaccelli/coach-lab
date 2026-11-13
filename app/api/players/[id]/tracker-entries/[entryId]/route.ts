import { NextResponse } from 'next/server';
import { coachSession, dbError, todayYmd } from '@/lib/players/routeKit';
import { validateEntry, type TrackerField, type TrackerMode } from '@/lib/players/trackers';

export const runtime = 'nodejs';

const ENTRY_COLS = 'id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at';

/**
 * Coach edits or reviews an entry.
 *  - Edit:   { entry_date, measurements | sets, note, expected_updated_at? }
 *  - Review: { status: 'approved' | 'needs_revision', review_note? }  (player submissions)
 * `expected_updated_at` turns an edit of a stale copy into a 409 instead of a silent overwrite.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; entryId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, entryId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: cur, error: ce } = await s.supabase.from('player_tracker_entries').select('id,tracker_id,status,updated_at').eq('id', entryId).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body?.status === 'approved' || body?.status === 'needs_revision') {
    const note = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 1000) : '';
    if (body.status === 'needs_revision' && !note) return NextResponse.json({ error: 'Say what needs to change' }, { status: 400 });
    patch = { status: body.status, review_note: note || null, reviewed_at: now, updated_at: now };
  } else {
    const { data: tracker, error: te } = await s.supabase.from('player_trackers').select('mode,fields').eq('id', cur.tracker_id).maybeSingle();
    if (te) return dbError(te);
    if (!tracker) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const v = validateEntry({ mode: tracker.mode as TrackerMode, fields: tracker.fields as TrackerField[] }, body, todayYmd());
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch = { ...v.value, updated_at: now };
  }
  let q = s.supabase.from('player_tracker_entries').update(patch).eq('id', entryId).eq('player_id', id);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(ENTRY_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'This entry was changed somewhere else. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ entry: data[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; entryId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, entryId } = await ctx.params;
  const { data, error } = await s.supabase.from('player_tracker_entries').delete().eq('id', entryId).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
