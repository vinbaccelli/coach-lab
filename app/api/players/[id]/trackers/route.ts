import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateTrackerDefinition, TRACKER_CATEGORIES, type TrackerCategory } from '@/lib/players/trackers';
import { presetByKey } from '@/lib/players/trackerPresets';

export const runtime = 'nodejs';

const TRACKER_COLS = 'id,player_id,name,description,category,preset,mode,fields,position,archived_at,created_at,updated_at';
const ENTRY_COLS = 'id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at';

/** Trackers of one player (optionally one or more categories) with their entries, oldest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const cats = (url.searchParams.get('category') ?? '').split(',').filter((c): c is TrackerCategory => TRACKER_CATEGORIES.includes(c as TrackerCategory));
  let q = s.supabase.from('player_trackers').select(TRACKER_COLS).eq('player_id', id);
  if (cats.length) q = q.in('category', cats);
  if (url.searchParams.get('archived') !== '1') q = q.is('archived_at', null);
  const { data: trackers, error } = await q.order('position', { ascending: true }).order('created_at', { ascending: true }).limit(200);
  if (error) return dbError(error, { trackers: [], entries: [] });
  const ids = (trackers ?? []).map((t) => t.id);
  if (!ids.length) return NextResponse.json({ trackers: [], entries: [] });
  const { data: entries, error: ee } = await s.supabase
    .from('player_tracker_entries').select(ENTRY_COLS).in('tracker_id', ids)
    .order('entry_date', { ascending: true }).order('created_at', { ascending: true }).limit(5000);
  if (ee) return dbError(ee, { trackers: [], entries: [] });
  return NextResponse.json({ trackers, entries: entries ?? [] });
}

/** Create a tracker from a preset key or a definition. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { preset?: string; definition?: unknown; category?: string } | null;
  const preset = body?.preset ? presetByKey(body.preset) : null;
  if (body?.preset && !preset) return NextResponse.json({ error: 'Unknown preset' }, { status: 400 });
  const v = validateTrackerDefinition(preset ? preset.definition : body?.definition);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const { data: last, error: le } = await s.supabase
    .from('player_trackers').select('position').eq('player_id', id).eq('category', v.value.category)
    .order('position', { ascending: false }).limit(1);
  if (le) return dbError(le);
  const position = ((last?.[0]?.position as number | undefined) ?? -1) + 1;

  const { data, error } = await s.supabase
    .from('player_trackers')
    .insert({ coach_id: s.userId, player_id: id, ...v.value, position })
    .select(TRACKER_COLS).single();
  if (error) return error.code === '42501' ? NextResponse.json({ error: 'Not your player' }, { status: 403 }) : dbError(error);
  return NextResponse.json({ tracker: data });
}
