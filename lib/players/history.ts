/**
 * The universal player timeline ("history"): pure logic shared by the server routes and the page.
 *
 * Every module keeps its own table; the history only READS them and turns each row into one item
 * with a stable key, so nothing is copied and nothing appears twice:
 *   i-<id>    comment / picture / video   (player_timeline_items; same keys as the old timeline,
 *                                          so the coach's manual order keeps working)
 *   e-<id>    report                       (player_entries)
 *   ts-<id>   dated technical comment      (players.technical_sheet, e.g. Forehand)
 *   m-<id>    measurement                  (player_tracker_entries; an entry copied from an old
 *                                          progress value keeps that value's key m-<legacy id>;
 *                                          the old player_metrics rows are read only while the
 *                                          tracker tables do not exist yet)
 *   t-<id>    measurement                  (player_tracker_entries without a legacy value)
 *   meal-<id> meal                         (player_meal_logs)
 *   plan-<id> nutrition plan / new version (player_nutrition_plans, its start date)
 *
 * Order: the day the item is about (newest first), then when it was created, then the key, so a
 * page boundary is exact. The cursor is that triple.
 */
import { MEAL_LABELS, type MealCategory } from '@/lib/players/nutrition';
import { describeEntry, formatValue, type TrackerDefinition, type TrackerEntry } from '@/lib/players/trackers';
import type { SharePermissions } from '@/lib/players/sharePermissions';

export const HISTORY_TYPES = ['comment', 'picture', 'video', 'report', 'technical', 'measurement', 'meal', 'plan'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];
export const HISTORY_SECTIONS = ['technical', 'progress', 'biometrics', 'fitness', 'nutrition', 'timeline'] as const;
export type HistorySection = (typeof HISTORY_SECTIONS)[number];

export const TYPE_LABELS: Record<HistoryType, string> = {
  comment: 'Comments', picture: 'Pictures', video: 'Videos', report: 'Reports', technical: 'Technical notes',
  measurement: 'Measurements', meal: 'Meals', plan: 'Nutrition plans',
};
export const SECTION_LABELS: Record<HistorySection, string> = {
  technical: 'Technical', progress: 'Progress', biometrics: 'Biometrics', fitness: 'Fitness', nutrition: 'Nutrition', timeline: 'Timeline',
};

export interface HistoryItem {
  key: string;
  type: HistoryType;
  section: HistorySection;
  /** The day the item is about (YYYY-MM-DD). */
  date: string;
  /** When it was created (ISO, UTC, ms): tie-break and cursor. */
  created_at: string;
  title: string;
  body?: string;
  imageUrl?: string;
  youtubeId?: string;
  author: 'coach' | 'link';
  status?: 'submitted' | 'approved' | 'needs_revision';
  /** Comments, pictures and videos can be deleted from the timeline (their id in player_timeline_items). */
  deletableId?: string;
}

export interface HistoryFilter {
  types: HistoryType[] | null;
  sections: HistorySection[] | null;
  author: 'coach' | 'link' | null;
  from: string | null;
  to: string | null;
}
export interface Cursor { date: string; created_at: string; key: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
export const isoMs = (v: string) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? new Date(0).toISOString() : new Date(t).toISOString();
};

/** Newest first: day, then creation time, then key. */
export function compareHistory(a: Pick<HistoryItem, 'date' | 'created_at' | 'key'>, b: Pick<HistoryItem, 'date' | 'created_at' | 'key'>): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  if (a.key !== b.key) return a.key < b.key ? 1 : -1;
  return 0;
}

export const encodeCursor = (c: Cursor) => `${c.date}|${c.created_at}|${c.key}`;
export function parseCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const [date, created_at, ...rest] = raw.split('|');
  const key = rest.join('|');
  if (!isDate(date) || Number.isNaN(Date.parse(created_at ?? '')) || !key) return null;
  return { date, created_at: isoMs(created_at), key };
}
/** True when the item comes strictly after the cursor in history order (older). */
export const afterCursor = (it: Pick<HistoryItem, 'date' | 'created_at' | 'key'>, c: Cursor | null) => !c || compareHistory(it, c) > 0;

export function parseFilter(sp: URLSearchParams): HistoryFilter {
  const list = <T extends string>(v: string | null, allowed: readonly T[]): T[] | null => {
    if (!v) return null;
    const out = v.split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
    return out.length ? out : null;
  };
  const author = sp.get('author');
  const from = sp.get('from');
  const to = sp.get('to');
  return {
    types: list(sp.get('types'), HISTORY_TYPES),
    sections: list(sp.get('sections'), HISTORY_SECTIONS),
    author: author === 'coach' || author === 'link' ? author : null,
    from: isDate(from) ? from : null,
    to: isDate(to) ? to : null,
  };
}
export const filterActive = (f: HistoryFilter) => Boolean(f.types || f.sections || f.author || f.from || f.to);

/** Does an item pass the filter (the routes also filter in the database; this is the exact rule)? */
export function matches(it: HistoryItem, f: HistoryFilter): boolean {
  if (f.types && !f.types.includes(it.type)) return false;
  if (f.sections && !f.sections.includes(it.section)) return false;
  if (f.author && it.author !== f.author) return false;
  if (f.from && it.date < f.from) return false;
  if (f.to && it.date > f.to) return false;
  return true;
}

/** Which sections a share link may see in the history (reports are never sent through a link). */
export function sectionsForLink(perms: SharePermissions): HistorySection[] {
  return HISTORY_SECTIONS.filter((s) => perms.see[s]);
}

/** Merge per-source lists (each may be longer than needed) into one page. */
export function mergePage(lists: HistoryItem[][], limit: number, cursor: Cursor | null, f: HistoryFilter): { items: HistoryItem[]; next: string | null } {
  const seen = new Set<string>();
  const all: HistoryItem[] = [];
  for (const l of lists) for (const it of l) {
    if (seen.has(it.key) || !afterCursor(it, cursor) || !matches(it, f)) continue;
    seen.add(it.key);
    all.push(it);
  }
  all.sort(compareHistory);
  const items = all.slice(0, limit);
  const last = items[items.length - 1];
  return { items, next: all.length > limit && last ? encodeCursor(last) : null };
}

// ── Row → item ──────────────────────────────────────────────────────────────────────────────────
const day = (iso: string) => isoMs(iso).slice(0, 10);
const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');

export function itemFromTimeline(r: { id: string; kind: string; body: string | null; media_url: string | null; youtube_id: string | null; created_at: string; author?: string | null }): HistoryItem | null {
  const type: HistoryType | null = r.kind === 'note' ? 'comment' : r.kind === 'picture' ? 'picture' : r.kind === 'video' ? 'video' : null;
  if (!type) return null;
  return {
    key: `i-${r.id}`, type, section: 'timeline', date: day(r.created_at), created_at: isoMs(r.created_at),
    title: type === 'comment' ? 'Comment' : type === 'picture' ? 'Picture' : 'Video',
    body: r.body || undefined,
    imageUrl: type === 'picture' ? r.media_url ?? undefined : undefined,
    youtubeId: type === 'video' ? r.youtube_id ?? undefined : undefined,
    author: r.author === 'link' ? 'link' : 'coach',
    deletableId: r.id,
  };
}

export function itemFromReport(r: { id: string; category: string | null; folder_label: string | null; body_text: string | null; created_at: string }): HistoryItem {
  return {
    key: `e-${r.id}`, type: 'report', section: 'technical', date: day(r.created_at), created_at: isoMs(r.created_at),
    title: `${r.category === 'match' ? 'Match' : 'Technical'} report${r.folder_label ? `: ${r.folder_label}` : ''}`,
    body: r.body_text ? r.body_text.slice(0, 280) : undefined, author: 'coach',
  };
}

export function itemFromMetric(r: { id: string; name: string; unit: string | null; value: number; recorded_on: string; created_at?: string | null; author?: string | null }): HistoryItem {
  return {
    key: `m-${r.id}`, type: 'measurement', section: 'progress', date: r.recorded_on.slice(0, 10),
    created_at: isoMs(r.created_at ?? `${r.recorded_on.slice(0, 10)}T00:00:00Z`),
    title: `${r.name}: ${num(Number(r.value))}${r.unit ? ` ${r.unit}` : ''}`, author: r.author === 'link' ? 'link' : 'coach',
  };
}

export type TrackerLite = Pick<TrackerDefinition, 'fields' | 'mode'> & { id: string; name: string; category: string };
export function itemFromTrackerEntry(e: TrackerEntry & { legacy_metric_id?: string | null }, t: TrackerLite, derived?: Record<string, number>): HistoryItem {
  const section: HistorySection = t.category === 'biometrics' || t.category === 'fitness' ? t.category : 'progress';
  // A one-value tracker named like its value ("Serve speed") reads "172 km/h", not "Serve speed 172 km/h" again.
  const only = t.mode !== 'sets' && t.fields.length === 1 && !t.fields[0].computed ? t.fields[0] : null;
  const v = only ? e.measurements?.[only.id] : undefined;
  const text = only && typeof v === 'number' && only.label.trim().toLowerCase() === t.name.trim().toLowerCase()
    ? formatValue(v, only.kind, only.unit)
    : describeEntry(t, e, derived);
  return {
    key: e.legacy_metric_id ? `m-${e.legacy_metric_id}` : `t-${e.id}`,
    type: 'measurement', section, date: e.entry_date.slice(0, 10), created_at: isoMs(e.created_at),
    title: t.name, body: [text, e.note ? `“${e.note}”` : ''].filter(Boolean).join('\n') || undefined,
    author: e.author === 'link' ? 'link' : 'coach', status: e.status,
  };
}

export function itemFromMeal(m: { id: string; eaten_on: string; eaten_at: string | null; category: string; description: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; photo_url: string | null; note: string; author: string; status: string; created_at: string }): HistoryItem {
  const facts = [
    m.calories !== null ? `${num(Number(m.calories))} kcal` : null,
    m.protein_g !== null ? `P ${num(Number(m.protein_g))} g` : null,
    m.carbs_g !== null ? `C ${num(Number(m.carbs_g))} g` : null,
    m.fat_g !== null ? `F ${num(Number(m.fat_g))} g` : null,
  ].filter(Boolean).join(' · ');
  return {
    key: `meal-${m.id}`, type: 'meal', section: 'nutrition', date: m.eaten_on.slice(0, 10), created_at: isoMs(m.created_at),
    title: `${MEAL_LABELS[m.category as MealCategory] ?? 'Meal'}${m.eaten_at ? ` · ${m.eaten_at.slice(0, 5)}` : ''}`,
    body: [m.description, facts, m.note ? `“${m.note}”` : ''].filter(Boolean).join('\n') || undefined,
    imageUrl: m.photo_url ?? undefined,
    author: m.author === 'link' ? 'link' : 'coach',
    status: m.status === 'submitted' || m.status === 'needs_revision' ? m.status : 'approved',
  };
}

export function itemFromPlan(p: { id: string; title: string; starts_on: string; ends_on: string | null; previous_id?: string | null; targets?: unknown; created_at: string }): HistoryItem {
  const t = (p.targets ?? {}) as { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null };
  const facts = [
    t.calories != null ? `${num(t.calories)} kcal` : null,
    t.protein_g != null ? `${num(t.protein_g)} g protein` : null,
    t.carbs_g != null ? `${num(t.carbs_g)} g carbs` : null,
    t.fat_g != null ? `${num(t.fat_g)} g fat` : null,
  ].filter(Boolean).join(' · ');
  return {
    key: `plan-${p.id}`, type: 'plan', section: 'nutrition', date: p.starts_on.slice(0, 10), created_at: isoMs(p.created_at),
    title: `${p.previous_id ? 'New version of the nutrition plan' : 'Nutrition plan'}: ${p.title}`,
    body: [facts, p.ends_on ? `Until ${p.ends_on}` : ''].filter(Boolean).join('\n') || undefined,
    author: 'coach',
  };
}

/** Dated comments of the technical sheet's tracking rows (Forehand…). They have no creation time: the day is used. */
export function itemsFromSheet(rows: readonly { label: string; kind?: string; entries?: readonly { id: string; date: string; text: string }[] }[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const r of rows) {
    if (r.kind !== 'track') continue;
    for (const e of r.entries ?? []) {
      if (!isDate(e.date) || !e.text?.trim()) continue;
      out.push({ key: `ts-${e.id}`, type: 'technical', section: 'technical', date: e.date, created_at: `${e.date}T00:00:00.000Z`, title: r.label, body: e.text, author: 'coach' });
    }
  }
  return out;
}
