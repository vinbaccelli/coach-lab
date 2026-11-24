import { isMissingTable } from '@/lib/db/missingTable';
import type { Db, Share } from '@/lib/players/shareAccess';
import type { MetricInput } from '@/lib/players/metrics';
import { inputFields, parseFieldInput, type TrackerField } from '@/lib/players/trackers';

/** Tracker reads and writes for the share link (server only, service role, always scoped to the link's player). */

const TRACKER_COLS = 'id,player_id,name,description,category,preset,mode,fields,position,archived_at,created_at,updated_at';
const ENTRY_COLS = 'id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at';

export async function loadShareTrackers(db: Db, playerId: string) {
  const t = await db.from('player_trackers').select(TRACKER_COLS).eq('player_id', playerId).is('archived_at', null)
    .order('category', { ascending: true }).order('position', { ascending: true }).limit(200);
  if (t.error) return { available: !isMissingTable(t.error), trackers: [], entries: [] };
  const ids = (t.data ?? []).map((x) => x.id);
  if (!ids.length) return { available: true, trackers: [], entries: [] };
  const e = await db.from('player_tracker_entries').select(ENTRY_COLS).in('tracker_id', ids)
    .order('entry_date', { ascending: true }).order('created_at', { ascending: true }).limit(5000);
  return { available: true, trackers: t.data ?? [], entries: e.data ?? [] };
}

/**
 * The share page's simple "add a value" form (name, unit, value, date) stores into a tracker
 * named after the value, the same way old progress values were migrated (one tracker per
 * name + unit). The entry waits for the coach's review. Returns null when the tracker tables
 * do not exist yet, so the caller can fall back to the legacy table.
 */
export async function addValueAsTrackerEntry(db: Db, share: Pick<Share, 'coach_id' | 'player_id'>, input: MetricInput): Promise<{ ok: true } | { ok: false; error: string } | null> {
  // 1. The coach's own tracker with that name, when it takes one value (e.g. "Serve speed").
  const named = await db.from('player_trackers').select('id,mode,fields').eq('player_id', share.player_id).is('archived_at', null)
    .ilike('name', input.name.trim().replace(/[\\%_]/g, (c) => `\\${c}`)).limit(5);
  if (named.error) return isMissingTable(named.error) ? null : { ok: false, error: 'Could not save' };
  for (const t of named.data ?? []) {
    const fields = inputFields((t.fields ?? []) as TrackerField[]);
    if (t.mode !== 'single' || fields.length !== 1) continue;
    const value = parseFieldInput(fields[0], String(input.value));
    if (typeof value !== 'number') continue;
    const ins = await db.from('player_tracker_entries').insert({
      coach_id: share.coach_id, player_id: share.player_id, tracker_id: t.id, entry_date: input.recorded_on,
      measurements: { [fields[0].id]: value }, note: input.note ?? '', author: 'link', status: 'submitted',
    });
    return ins.error ? { ok: false, error: 'Could not save' } : { ok: true };
  }
  // 2. Otherwise the tracker made for that name + unit (as old values were migrated), created on first use.
  const legacy_key = `${input.name.trim().toLowerCase()}|${input.unit.trim().toLowerCase()}`;
  const found = await db.from('player_trackers').select('id').eq('player_id', share.player_id).eq('legacy_key', legacy_key).maybeSingle();
  if (found.error) return isMissingTable(found.error) ? null : { ok: false, error: 'Could not save' };
  let trackerId = found.data?.id as string | undefined;
  if (!trackerId) {
    const created = await db.from('player_trackers').insert({
      coach_id: share.coach_id, player_id: share.player_id, name: input.name.trim(), category: 'progress', mode: 'single',
      fields: [{ id: 'value', label: input.name.trim(), kind: 'number', unit: input.unit.trim(), better: null }], legacy_key,
    }).select('id').single();
    if (created.error) return { ok: false, error: 'Could not save' };
    trackerId = created.data.id as string;
  }
  const ins = await db.from('player_tracker_entries').insert({
    coach_id: share.coach_id, player_id: share.player_id, tracker_id: trackerId, entry_date: input.recorded_on,
    measurements: { value: input.value }, note: input.note ?? '', author: 'link', status: 'submitted',
  });
  return ins.error ? { ok: false, error: 'Could not save' } : { ok: true };
}
