/**
 * Workouts: pure logic shared by the routes and the pages.
 *
 * PLANNED and DONE are separate: a planned workout (player_workouts) holds the plan for each
 * exercise (sets × reps × weight, a time, a distance, rest); a log (player_workout_logs) holds the
 * sets actually performed. The comparison is computed, never stored.
 */
import { formatDuration, parseFieldInput } from '@/lib/players/trackers';

export const EXERCISE_CATEGORIES = ['strength', 'conditioning', 'speed_agility', 'plyometrics', 'core', 'mobility', 'warm_up', 'recovery', 'tennis', 'other'] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: 'Strength', conditioning: 'Conditioning', speed_agility: 'Speed & agility', plyometrics: 'Plyometrics', core: 'Core',
  mobility: 'Mobility', warm_up: 'Warm-up', recovery: 'Recovery', tennis: 'Tennis-specific', other: 'Other',
};
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const LOG_FIELDS = ['reps', 'weight', 'duration', 'distance'] as const;
export type LogField = (typeof LOG_FIELDS)[number];
export const LOG_FIELD_LABELS: Record<LogField, string> = { reps: 'Reps', weight: 'Weight (kg)', duration: 'Time', distance: 'Distance (m)' };

export const MAX_ITEMS = 40;
export const MAX_DONE_SETS = 30;
export const MAX_SERIES = 60;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, maxItems: number, maxLen = 40) =>
  [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => text(x, maxLen).toLowerCase()).filter(Boolean))].slice(0, maxItems);
const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\/\S+$/.test(v.trim()) ? v.trim().slice(0, 500) : null);

/** A number from a form (comma decimals allowed), or null when empty; 'bad' when not a number in range. */
function num(v: unknown, max: number, opts: { int?: boolean; min?: number } = {}): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < (opts.min ?? 0) || n > max) return 'bad';
  return opts.int ? Math.round(n) : Math.round(n * 100) / 100;
}
/** Seconds from "45", "1:30" or "1:02:00"; null when empty; 'bad' otherwise. */
function seconds(v: unknown): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const s = parseFieldInput({ kind: 'duration', unit: 's' }, typeof v === 'number' ? v : String(v));
  if (s === 'invalid' || (typeof s === 'number' && (s < 0 || s > 86400))) return 'bad';
  return s;
}

// ── Exercise library ────────────────────────────────────────────────────────────────────────────
export interface ExerciseInput {
  name: string;
  description: string;
  category: ExerciseCategory;
  muscle_groups: string[];
  equipment: string[];
  instructions: string;
  video_url: string | null;
  thumbnail_url: string | null;
  difficulty: Difficulty;
  sports: string[];
  log_fields: LogField[];
}
export interface Exercise extends ExerciseInput {
  id: string;
  coach_id: string | null;
  slug: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function validateExercise(raw: unknown): Result<ExerciseInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const name = text(b.name, 80);
  if (!name) return fail('The exercise needs a name');
  const log_fields = (Array.isArray(b.log_fields) ? b.log_fields : []).filter((f): f is LogField => (LOG_FIELDS as readonly unknown[]).includes(f));
  return {
    ok: true,
    value: {
      name,
      description: text(b.description, 2000),
      category: (EXERCISE_CATEGORIES as readonly unknown[]).includes(b.category) ? (b.category as ExerciseCategory) : 'other',
      muscle_groups: list(b.muscle_groups, 12),
      equipment: list(b.equipment, 12),
      instructions: text(b.instructions, 4000),
      video_url: url(b.video_url),
      thumbnail_url: url(b.thumbnail_url),
      difficulty: (DIFFICULTIES as readonly unknown[]).includes(b.difficulty) ? (b.difficulty as Difficulty) : 'intermediate',
      sports: list(b.sports, 12),
      log_fields: log_fields.length ? [...new Set(log_fields)] : ['reps', 'weight'],
    },
  };
}

/** Search the library: every word must appear in the name, a muscle group, equipment or category. */
export function searchExercises<T extends { name: string; muscle_groups: string[]; equipment: string[]; category: string; sports: string[] }>(all: readonly T[], query: string, category?: string | null): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((e) => {
    if (category && e.category !== category) return false;
    const hay = [e.name, ...e.muscle_groups, ...e.equipment, CATEGORY_LABELS[e.category as ExerciseCategory] ?? e.category, ...e.sports].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── Planned items (templates and planned workouts) ──────────────────────────────────────────────
export interface PlannedItem {
  id: string;
  exercise_id: string | null;
  name: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  duration_s: number | null;
  distance_m: number | null;
  rest_s: number | null;
  notes: string;
  log_fields: LogField[];
}

export function validateItems(raw: unknown): Result<PlannedItem[]> {
  if (!Array.isArray(raw)) return { ok: true, value: [] };
  if (raw.length > MAX_ITEMS) return fail(`At most ${MAX_ITEMS} exercises in a workout`);
  const out: PlannedItem[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = text(o.name, 80);
    if (!name) continue;
    const sets = num(o.sets, 30, { int: true });
    const reps = num(o.reps, 1000, { int: true });
    const weight_kg = num(o.weight_kg, 1000);
    const distance_m = num(o.distance_m, 100000);
    const duration_s = seconds(o.duration_s);
    const rest_s = seconds(o.rest_s);
    if ([sets, reps, weight_kg, distance_m, duration_s, rest_s].includes('bad')) return fail(`Check the numbers for ${name}`);
    let id = typeof o.id === 'string' && /^[\w-]{1,64}$/.test(o.id) ? o.id : `x${out.length + 1}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const fields = (Array.isArray(o.log_fields) ? o.log_fields : []).filter((f): f is LogField => (LOG_FIELDS as readonly unknown[]).includes(f));
    out.push({
      id,
      exercise_id: typeof o.exercise_id === 'string' && /^[0-9a-f-]{36}$/i.test(o.exercise_id) ? o.exercise_id : null,
      name,
      sets: sets as number | null, reps: reps as number | null, weight_kg: weight_kg as number | null,
      duration_s: duration_s as number | null, distance_m: distance_m as number | null, rest_s: rest_s as number | null,
      notes: text(o.notes, 500),
      log_fields: fields.length ? [...new Set(fields)] : ['reps', 'weight'],
    });
  }
  return { ok: true, value: out };
}

export interface WorkoutInput { title: string; notes: string; items: PlannedItem[] }
export function validateWorkout(raw: unknown): Result<WorkoutInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = text(b.title, 120);
  if (!title) return fail('The workout needs a name');
  const items = validateItems(b.items);
  if (!items.ok) return items;
  return { ok: true, value: { title, notes: text(b.notes, 4000), items: items.value } };
}

/** "3 × 12 × 40 kg", "3 × 45 s", "5 km in 25:00", "rest 1:30". */
export function describePlanned(p: Pick<PlannedItem, 'sets' | 'reps' | 'weight_kg' | 'duration_s' | 'distance_m' | 'rest_s'>): string {
  const parts: string[] = [];
  const per = [
    p.reps !== null ? `${p.reps}` : null,
    p.weight_kg !== null ? `${p.weight_kg} kg` : null,
    p.duration_s !== null ? formatDuration(p.duration_s) : null,
    p.distance_m !== null ? (p.distance_m >= 1000 ? `${Math.round(p.distance_m / 10) / 100} km` : `${p.distance_m} m`) : null,
  ].filter(Boolean).join(' × ');
  if (p.sets !== null && p.sets > 0) parts.push(per ? `${p.sets} × ${per}` : `${p.sets} sets`);
  else if (per) parts.push(per);
  if (p.rest_s !== null) parts.push(`rest ${formatDuration(p.rest_s)}`);
  return parts.join(', ');
}

// ── Scheduling ──────────────────────────────────────────────────────────────────────────────────
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/**
 * The dates of a series: from `start`, every weekday listed (0 = Sunday … 6 = Saturday) for `weeks`
 * weeks. No weekdays = just the start date. At most MAX_SERIES dates.
 */
export function scheduleDates(start: string, weekdays: readonly number[], weeks: number): Result<string[]> {
  if (!isDate(start)) return fail('Choose the first date');
  const days = [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (!days.length) return { ok: true, value: [start] };
  const w = Math.round(weeks);
  if (!Number.isFinite(w) || w < 1 || w > 52) return fail('Repeat for 1 to 52 weeks');
  const out: string[] = [];
  for (let i = 0; i < w * 7 && out.length < MAX_SERIES; i++) {
    const d = addDays(start, i);
    if (days.includes(weekday(d))) out.push(d);
  }
  if (!out.length) return fail('No date matches these days');
  return { ok: true, value: out };
}

// ── What was done ───────────────────────────────────────────────────────────────────────────────
export interface DoneSet { reps?: number; weight_kg?: number; duration_s?: number; distance_m?: number }
export interface DoneItem { id: string; exercise_id: string | null; planned_id: string | null; name: string; sets: DoneSet[]; notes: string }
export interface LogInput {
  performed_on: string;
  title: string;
  items: DoneItem[];
  duration_min: number | null;
  rpe: number | null;
  notes: string;
}

export function validateLog(raw: unknown, today: string): Result<LogInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const performed_on = isDate(b.performed_on) ? b.performed_on : today;
  if (performed_on > addDays(today, 1) || performed_on < '1900-01-01') return fail('The date cannot be in the future');
  const title = text(b.title, 120) || 'Workout';
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length > MAX_ITEMS) return fail(`At most ${MAX_ITEMS} exercises in a workout`);
  const items: DoneItem[] = [];
  for (const r of rawItems) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = text(o.name, 80);
    if (!name) continue;
    const rawSets = Array.isArray(o.sets) ? o.sets : [];
    if (rawSets.length > MAX_DONE_SETS) return fail(`At most ${MAX_DONE_SETS} sets for ${name}`);
    const sets: DoneSet[] = [];
    for (const s of rawSets) {
      const so = (s ?? {}) as Record<string, unknown>;
      const reps = num(so.reps, 1000, { int: true });
      const weight = num(so.weight_kg, 1000);
      const dist = num(so.distance_m, 100000);
      const dur = seconds(so.duration_s);
      if ([reps, weight, dist, dur].includes('bad')) return fail(`Check the numbers for ${name}`);
      const set: DoneSet = {};
      if (typeof reps === 'number') set.reps = reps;
      if (typeof weight === 'number') set.weight_kg = weight;
      if (typeof dur === 'number') set.duration_s = dur;
      if (typeof dist === 'number') set.distance_m = dist;
      if (Object.keys(set).length) sets.push(set);
    }
    items.push({
      id: typeof o.id === 'string' && /^[\w-]{1,64}$/.test(o.id) ? o.id : `d${items.length + 1}`,
      exercise_id: typeof o.exercise_id === 'string' && /^[0-9a-f-]{36}$/i.test(o.exercise_id) ? o.exercise_id : null,
      planned_id: typeof o.planned_id === 'string' && /^[\w-]{1,64}$/.test(o.planned_id) ? o.planned_id : null,
      name, sets, notes: text(o.notes, 500),
    });
  }
  const duration_min = num(b.duration_min, 1440);
  const rpe = num(b.rpe, 10, { min: 1 });
  if (duration_min === 'bad') return fail('The duration must be minutes (0 to 1440)');
  if (rpe === 'bad') return fail('Effort is from 1 to 10');
  const notes = text(b.notes, 2000);
  if (!items.some((i) => i.sets.length) && !notes && duration_min === null) return fail('Add at least one set, a duration or a note');
  return { ok: true, value: { performed_on, title, items, duration_min, rpe, notes } };
}

/** A log form prefilled from the plan: one entry per planned exercise with its planned sets. */
export function logFromPlan(items: readonly PlannedItem[]): DoneItem[] {
  return items.map((p) => ({
    id: p.id, exercise_id: p.exercise_id, planned_id: p.id, name: p.name, notes: '',
    sets: Array.from({ length: Math.max(1, Math.min(MAX_DONE_SETS, p.sets ?? 1)) }, () => {
      const s: DoneSet = {};
      if (p.reps !== null) s.reps = p.reps;
      if (p.weight_kg !== null) s.weight_kg = p.weight_kg;
      if (p.duration_s !== null) s.duration_s = p.duration_s;
      if (p.distance_m !== null) s.distance_m = p.distance_m;
      return s;
    }),
  }));
}

export function describeDone(sets: readonly DoneSet[]): string {
  if (!sets.length) return 'not done';
  const one = (s: DoneSet) => [
    s.reps !== undefined ? `${s.reps}` : null,
    s.weight_kg !== undefined ? `${s.weight_kg} kg` : null,
    s.duration_s !== undefined ? formatDuration(s.duration_s) : null,
    s.distance_m !== undefined ? (s.distance_m >= 1000 ? `${Math.round(s.distance_m / 10) / 100} km` : `${s.distance_m} m`) : null,
  ].filter(Boolean).join(' × ');
  const texts = sets.map(one);
  const same = texts.every((t) => t === texts[0]);
  return same ? `${sets.length} × ${texts[0]}` : texts.join(', ');
}

/** Planned against done, per exercise (by planned id, then by name). Extra exercises are listed too. */
export function comparePlanned(planned: readonly PlannedItem[], done: readonly DoneItem[]) {
  const used = new Set<string>();
  const rows = planned.map((p) => {
    const d = done.find((x) => !used.has(x.id) && x.planned_id === p.id) ?? done.find((x) => !used.has(x.id) && x.name.toLowerCase() === p.name.toLowerCase());
    if (d) used.add(d.id);
    const doneSets = d?.sets.length ?? 0;
    const status: 'done' | 'partial' | 'missed' = !d || doneSets === 0 ? 'missed' : p.sets !== null && doneSets < p.sets ? 'partial' : 'done';
    return { name: p.name, planned: describePlanned(p), done: d ? describeDone(d.sets) : 'not done', status };
  });
  for (const d of done) if (!used.has(d.id) && d.sets.length) rows.push({ name: d.name, planned: '—', done: describeDone(d.sets), status: 'done' as const, extra: true } as never);
  return rows as Array<{ name: string; planned: string; done: string; status: 'done' | 'partial' | 'missed'; extra?: boolean }>;
}

export type WorkoutState = 'done' | 'skipped' | 'today' | 'upcoming' | 'missed';
/** Where a planned workout stands: done (it has a log), skipped, today, upcoming or missed (past, no log). */
export function workoutState(w: { scheduled_on: string; status: string }, hasLog: boolean, today: string): WorkoutState {
  if (hasLog) return 'done';
  if (w.status === 'skipped') return 'skipped';
  if (w.scheduled_on === today) return 'today';
  return w.scheduled_on > today ? 'upcoming' : 'missed';
}
