import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid, todayYmd } from '@/lib/players/routeKit';
import { validateEntry, type TrackerField, type TrackerMode } from '@/lib/players/trackers';

export const runtime = 'nodejs';

const ENTRY_COLS = 'id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at';

/**
 * Add an entry to a tracker (coach). Body: { entry_date, measurements | sets, note, client_ref }.
 * `client_ref` (a UUID made by the page per submit) makes a double tap or a retry return the
 * entry that was already saved instead of adding it twice.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; trackerId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, trackerId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { data: tracker, error: te } = await s.supabase.from('player_trackers').select('id,mode,fields,archived_at').eq('id', trackerId).eq('player_id', id).maybeSingle();
  if (te) return dbError(te);
  if (!tracker) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const v = validateEntry({ mode: tracker.mode as TrackerMode, fields: tracker.fields as TrackerField[] }, body, todayYmd());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const client_ref = isUuid(body?.client_ref) ? body.client_ref : null;

  const { data, error } = await s.supabase
    .from('player_tracker_entries')
    .insert({ coach_id: s.userId, player_id: id, tracker_id: trackerId, ...v.value, author: 'coach', status: 'approved', client_ref })
    .select(ENTRY_COLS).single();
  if (error && error.code === '23505' && client_ref) {
    const { data: existing } = await s.supabase.from('player_tracker_entries').select(ENTRY_COLS).eq('tracker_id', trackerId).eq('client_ref', client_ref).maybeSingle();
    if (existing) return NextResponse.json({ entry: existing, duplicate: true });
  }
  if (error) return dbError(error);
  return NextResponse.json({ entry: data });
}
