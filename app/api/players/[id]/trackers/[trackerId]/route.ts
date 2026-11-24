import { NextResponse } from 'next/server';
import { coachSession, dbError } from '@/lib/players/routeKit';
import { validateTrackerDefinition, checkFieldChanges, type TrackerField } from '@/lib/players/trackers';

export const runtime = 'nodejs';

const TRACKER_COLS = 'id,player_id,name,description,category,preset,mode,fields,position,archived_at,created_at,updated_at';

/**
 * Edit a tracker: { definition?, archived?, expected_updated_at? }. A measurement that exists can be
 * renamed or archived but not removed or retyped (its history would lose its meaning), and the
 * mode cannot change once there are entries. `expected_updated_at` makes a stale edit a 409.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; trackerId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, trackerId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { definition?: unknown; archived?: boolean; expected_updated_at?: string } | null;
  const { data: cur, error: ce } = await s.supabase.from('player_trackers').select(TRACKER_COLS).eq('id', trackerId).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.definition !== undefined) {
    const v = validateTrackerDefinition(body.definition);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const changed = checkFieldChanges(cur.fields as TrackerField[], v.value.fields);
    if (changed) return NextResponse.json({ error: changed }, { status: 400 });
    if (v.value.mode !== cur.mode) {
      const { count } = await s.supabase.from('player_tracker_entries').select('id', { count: 'exact', head: true }).eq('tracker_id', trackerId);
      if ((count ?? 0) > 0) return NextResponse.json({ error: 'The entry type cannot change once the tracker has entries' }, { status: 400 });
    }
    Object.assign(patch, { name: v.value.name, description: v.value.description, mode: v.value.mode, fields: v.value.fields, category: v.value.category });
  }
  if (typeof body?.archived === 'boolean') patch.archived_at = body.archived ? new Date().toISOString() : null;

  let q = s.supabase.from('player_trackers').update(patch).eq('id', trackerId).eq('player_id', id);
  if (body?.expected_updated_at) q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(TRACKER_COLS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'This tracker was changed somewhere else. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ tracker: data[0] });
}

/** Delete a tracker and its entries (the page asks for confirmation first). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; trackerId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, trackerId } = await ctx.params;
  const { data, error } = await s.supabase.from('player_trackers').delete().eq('id', trackerId).eq('player_id', id).select('id');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
