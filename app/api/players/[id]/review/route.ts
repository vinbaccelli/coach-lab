import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';

export const runtime = 'nodejs';

/**
 * Everything the player sent through the share link that waits for the coach: tracker entries
 * with status `submitted` (later releases add meals and workouts). Newest first, with the tracker
 * each one belongs to, so the coach can approve or ask for a fix from one place.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const { data: entries, error } = await s.supabase
    .from('player_tracker_entries')
    .select('id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at')
    .eq('player_id', id).eq('status', 'submitted').order('created_at', { ascending: false }).limit(200);
  if (error) return dbError(error, { entries: [], trackers: [] });
  const ids = [...new Set((entries ?? []).map((e) => e.tracker_id))];
  if (!ids.length) return NextResponse.json({ entries: [], trackers: [] });
  const { data: trackers, error: te } = await s.supabase
    .from('player_trackers').select('id,player_id,name,description,category,preset,mode,fields,position,archived_at,created_at,updated_at').in('id', ids);
  if (te) return dbError(te, { entries: [], trackers: [] });
  return NextResponse.json({ entries: entries ?? [], trackers: trackers ?? [] });
}
