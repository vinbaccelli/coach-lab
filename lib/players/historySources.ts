import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/db/missingTable';
import { parseTechnicalSheet } from '@/lib/players/technicalSheet';
import { computeDerived, type TrackerEntry, type TrackerField, type TrackerMode } from '@/lib/players/trackers';
import {
  itemFromMeal, itemFromMetric, itemFromPlan, itemFromReport, itemFromTimeline, itemFromTrackerEntry, itemsFromSheet, mergePage,
  type Cursor, type HistoryFilter, type HistoryItem, type HistorySection, type HistoryType, type TrackerLite,
} from '@/lib/players/history';

/**
 * Reads one page of a player's history from every module (server only; coach session or the
 * service role scoped to a share link's player). Each source is read in history order with at most
 * limit + 1 rows after the cursor, so the merged page is exact. A module whose tables do not exist
 * yet contributes nothing.
 */
export interface HistoryOptions {
  viewer: 'coach' | 'link';
  playerId: string;
  filter: HistoryFilter;
  cursor: Cursor | null;
  limit: number;
  /** Sections the viewer may see (a share link's permissions); null = every section. */
  sections: HistorySection[] | null;
}

type Res = { data: unknown[] | null; error: { code?: string | null; message?: string | null } | null };
// The few query-builder methods used here (structural, so the user-scoped and service clients both fit).
interface Q extends PromiseLike<Res> {
  eq(column: string, value: unknown): Q;
  neq(column: string, value: unknown): Q;
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  is(column: string, value: null): Q;
  order(column: string, options: { ascending: boolean }): Q;
  limit(n: number): Q;
}

const startOf = (ymd: string) => `${ymd}T00:00:00.000Z`;
const nextDay = (ymd: string) => new Date(Date.parse(startOf(ymd)) + 86_400_000).toISOString();
const msAfter = (iso: string) => new Date(Date.parse(iso) + 1).toISOString();

/** Upper bound (exclusive) of created_at for rows whose day is their creation day, at a cursor. */
function createdUpper(c: Cursor): string {
  const lo = startOf(c.date);
  const hi = nextDay(c.date);
  const at = msAfter(c.created_at);
  return at < lo ? lo : at > hi ? hi : at;
}

/** Rows whose history day is their creation time (comments, pictures, videos, reports). */
async function byCreated(base: () => Q, f: HistoryFilter, c: Cursor | null, limit: number): Promise<Res> {
  let q = base();
  if (f.from) q = q.gte('created_at', startOf(f.from));
  if (f.to) q = q.lt('created_at', nextDay(f.to));
  if (c) q = q.lt('created_at', createdUpper(c));
  return q.order('created_at', { ascending: false }).limit(limit);
}

/** Rows with a DATE column for their day: at a cursor, the rest of the cursor's day, then older days. */
async function byDate(base: () => Q, col: string, f: HistoryFilter, c: Cursor | null, limit: number): Promise<Res> {
  const range = (q: Q) => {
    let out = q;
    if (f.from) out = out.gte(col, f.from);
    if (f.to) out = out.lte(col, f.to);
    return out;
  };
  if (!c) return range(base()).order(col, { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  const [same, older] = await Promise.all([
    range(base()).eq(col, c.date).lt('created_at', msAfter(c.created_at)).order('created_at', { ascending: false }).limit(limit),
    range(base()).lt(col, c.date).order(col, { ascending: false }).order('created_at', { ascending: false }).limit(limit),
  ]);
  if (same.error) return same;
  if (older.error) return older;
  return { data: [...(same.data ?? []), ...(older.data ?? [])], error: null };
}

export async function loadHistory(client: SupabaseClient, o: HistoryOptions): Promise<{ items: HistoryItem[]; next: string | null; available: { trackers: boolean; nutrition: boolean }; error?: string }> {
  const db = client as unknown as { from: (table: string) => { select: (cols: string) => Q } };
  const f = o.filter;
  const c = o.cursor;
  const L = o.limit + 1;
  const allowed = (section: HistorySection) => (!o.sections || o.sections.includes(section)) && (!f.sections || f.sections.includes(section));
  const want = (type: HistoryType, section: HistorySection) => (!f.types || f.types.includes(type)) && allowed(section);
  const coachOnly = f.author === 'link';
  const withAuthor = (q: Q) => (f.author ? q.eq('author', f.author) : q);
  const lists: HistoryItem[][] = [];
  const available = { trackers: true, nutrition: true };
  let failure: string | undefined;
  const take = (res: Res, map: (row: never) => HistoryItem | null, module?: 'trackers' | 'nutrition') => {
    if (res.error) {
      if (isMissingTable(res.error)) { if (module) available[module] = false; return; }
      failure = res.error.message ?? 'Database error';
      return;
    }
    lists.push((res.data ?? []).map((r) => map(r as never)).filter((x): x is HistoryItem => Boolean(x)));
  };
  const jobs: Promise<void>[] = [];

  // Comments, pictures, videos.
  const timelineTypes = (['comment', 'picture', 'video'] as const).filter((t) => want(t, 'timeline'));
  if (timelineTypes.length) {
    const kinds = timelineTypes.map((t) => (t === 'comment' ? 'note' : t));
    jobs.push(byCreated(() => withAuthor(db.from('player_timeline_items').select('id,kind,body,media_url,youtube_id,created_at,author').eq('player_id', o.playerId).in('kind', kinds)), f, c, L)
      .then((r) => take(r, itemFromTimeline)));
  }
  // Reports: the coach's only (never through a share link).
  if (o.viewer === 'coach' && !coachOnly && want('report', 'technical')) {
    jobs.push(byCreated(() => db.from('player_entries').select('id,category,folder_label,body_text,created_at').eq('player_id', o.playerId), f, c, L)
      .then((r) => take(r, itemFromReport)));
  }
  // Dated technical comments (Forehand, Backhand…), from the player's sheet.
  if (!coachOnly && want('technical', 'technical')) {
    jobs.push(Promise.resolve(db.from('players').select('technical_sheet').eq('id', o.playerId).limit(1)).then((r) => {
      if (r.error) { failure = r.error.message ?? 'Database error'; return; }
      const row = (r.data?.[0] ?? null) as { technical_sheet?: unknown } | null;
      lists.push(itemsFromSheet(parseTechnicalSheet(row?.technical_sheet) ?? []));
    }));
  }
  // Measurements: tracker entries (or the old progress values while the tracker tables do not exist).
  const measureSections = (['progress', 'biometrics', 'fitness'] as const).filter((s) => want('measurement', s));
  if (measureSections.length) {
    jobs.push((async () => {
      let tq = db.from('player_trackers').select('id,name,category,mode,fields,archived_at').eq('player_id', o.playerId);
      if (o.viewer === 'link') tq = tq.is('archived_at', null);
      const tr = await tq.limit(300);
      if (tr.error && isMissingTable(tr.error)) {
        available.trackers = false;
        if (!measureSections.includes('progress')) return;
        const legacy = await byDate(() => withAuthor(db.from('player_metrics').select('id,name,unit,value,recorded_on,created_at,author').eq('player_id', o.playerId)), 'recorded_on', f, c, L);
        take(legacy, itemFromMetric);
        return;
      }
      if (tr.error) { failure = tr.error.message ?? 'Database error'; return; }
      const trackers = ((tr.data ?? []) as Array<{ id: string; name: string; category: string; mode: TrackerMode; fields: TrackerField[] }>)
        .filter((t) => (measureSections as readonly string[]).includes(t.category === 'other' ? 'progress' : t.category));
      if (!trackers.length) return;
      const byId = new Map<string, TrackerLite>(trackers.map((t) => [t.id, t]));
      const res = await byDate(() => withAuthor(db.from('player_tracker_entries')
        .select('id,tracker_id,entry_date,measurements,sets,note,author,status,review_note,created_at,updated_at,legacy_metric_id')
        .eq('player_id', o.playerId).in('tracker_id', trackers.map((t) => t.id))), 'entry_date', f, c, L);
      if (res.error) { take(res, () => null, 'trackers'); return; }
      const rows = (res.data ?? []) as Array<TrackerEntry & { legacy_metric_id?: string | null }>;
      const derived = new Map<string, Record<string, number>>();
      for (const t of trackers) {
        const mine = rows.filter((e) => e.tracker_id === t.id);
        if (mine.length) computeDerived(t, mine).forEach((v, k) => derived.set(k, v));
      }
      lists.push(rows.map((e) => { const t = byId.get(e.tracker_id); return t ? itemFromTrackerEntry(e, t, derived.get(e.id)) : null; }).filter((x): x is HistoryItem => Boolean(x)));
    })());
  }
  // Nutrition: meals, and plans on their start date.
  if (want('meal', 'nutrition')) {
    jobs.push(byDate(() => withAuthor(db.from('player_meal_logs').select('id,eaten_on,eaten_at,category,description,calories,protein_g,carbs_g,fat_g,photo_url,note,author,status,created_at').eq('player_id', o.playerId)), 'eaten_on', f, c, L)
      .then((r) => take(r, itemFromMeal, 'nutrition')));
  }
  if (!coachOnly && want('plan', 'nutrition')) {
    const base = () => {
      const q = db.from('player_nutrition_plans').select('id,title,starts_on,ends_on,previous_id,targets,status,created_at').eq('player_id', o.playerId);
      return o.viewer === 'link' ? q.eq('status', 'active') : q.neq('status', 'draft');
    };
    jobs.push(byDate(base, 'starts_on', f, c, L).then((r) => take(r, itemFromPlan, 'nutrition')));
  }

  await Promise.all(jobs);
  if (failure) return { items: [], next: null, available, error: failure };
  const visible = lists.map((l) => l.filter((it) => allowed(it.section)));
  return { ...mergePage(visible, o.limit, c, f), available };
}
