/**
 * Structured progress trackers: pure logic shared by the API routes and the pages.
 *
 * A TRACKER is one thing measured over time for one player ("Squat", "Biometrics", "5 km run").
 * Its FIELDS are the measurements, each with a stable id, a kind and a unit. An ENTRY is one
 * dated record: `measurements` {fieldId: number} in 'single' mode, or `sets` [{fieldId: number}]
 * in 'sets' mode (3 × 12 reps × 40 kg). Nothing here knows about a sport.
 *
 * Units: values are stored in the unit the field declares, except durations, which are always
 * stored in SECONDS (typed as m:ss, h:mm:ss, or a plain number read in the field's unit).
 */

export const FIELD_KINDS = ['number', 'count', 'weight', 'length', 'distance', 'duration', 'speed', 'percent', 'score'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Unit choices per kind (the first is the default). `number` and `count` also accept free text. */
export const KIND_UNITS: Record<FieldKind, readonly string[]> = {
  number: [''],
  count: ['reps', 'times', ''],
  weight: ['kg', 'lb'],
  length: ['cm', 'm', 'in'],
  distance: ['km', 'm', 'mi'],
  duration: ['min', 's', 'h'],
  speed: ['km/h', 'mph', 'm/s'],
  percent: ['%'],
  score: ['/10', '/5', '/100'],
};

export const KIND_LABELS: Record<FieldKind, string> = {
  number: 'Number',
  count: 'Count (reps)',
  weight: 'Weight',
  length: 'Length / height',
  distance: 'Distance',
  duration: 'Time',
  speed: 'Speed',
  percent: 'Percentage',
  score: 'Score',
};

export const TRACKER_CATEGORIES = ['progress', 'biometrics', 'fitness', 'technical', 'mental', 'nutrition', 'other'] as const;
export type TrackerCategory = (typeof TRACKER_CATEGORIES)[number];
export type TrackerMode = 'single' | 'sets';
export type Better = 'higher' | 'lower' | null;
export type Computed = 'bmi' | 'pace';

export interface TrackerField {
  id: string;
  label: string;
  kind: FieldKind;
  unit: string;
  better?: Better;
  /** Derived from other fields, never typed in. */
  computed?: Computed | null;
  /** Hidden from new entries; old values stay in the history. */
  archived?: boolean;
}

export interface TrackerDefinition {
  name: string;
  description: string;
  category: TrackerCategory;
  preset: string | null;
  mode: TrackerMode;
  fields: TrackerField[];
}

export interface Tracker extends TrackerDefinition {
  id: string;
  player_id: string;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EntryStatus = 'approved' | 'submitted' | 'needs_revision';
export type EntryAuthor = 'coach' | 'link';

export interface TrackerEntry {
  id: string;
  tracker_id: string;
  entry_date: string;
  measurements: Record<string, number>;
  sets: Array<Record<string, number>> | null;
  note: string;
  author: EntryAuthor;
  status: EntryStatus;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
}

export const MAX_FIELDS = 12;
export const MAX_SETS = 30;
const FIELD_ID = /^[a-z][a-z0-9_]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

// ── Definitions ────────────────────────────────────────────────────────────────────────────

/** A field id from a label: "Body fat %" -> "body_fat"; made unique against `taken`. */
export function fieldIdFor(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  if (!/^[a-z]/.test(base)) base = `f_${base}`.replace(/_+$/, '');
  if (base === 'f') base = 'field';
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
  return id;
}

function cleanField(raw: unknown, seen: Set<string>): Result<TrackerField> {
  const f = (raw ?? {}) as Record<string, unknown>;
  const label = typeof f.label === 'string' ? f.label.trim() : '';
  if (!label || label.length > 40) return fail('Each measurement needs a name (max 40 characters)');
  const kind = FIELD_KINDS.includes(f.kind as FieldKind) ? (f.kind as FieldKind) : null;
  if (!kind) return fail(`"${label}": unknown measurement type`);
  const id = typeof f.id === 'string' && FIELD_ID.test(f.id) ? f.id : fieldIdFor(label, seen);
  if (seen.has(id)) return fail(`Two measurements share the id "${id}"`);
  seen.add(id);
  let unit = typeof f.unit === 'string' ? f.unit.trim().slice(0, 12) : '';
  const allowed = KIND_UNITS[kind];
  if (kind !== 'number' && kind !== 'count' && !allowed.includes(unit)) unit = allowed[0];
  const better: Better = f.better === 'higher' || f.better === 'lower' ? f.better : null;
  const computed: Computed | null = f.computed === 'bmi' || f.computed === 'pace' ? f.computed : null;
  const field: TrackerField = { id, label, kind, unit, better };
  if (computed) field.computed = computed;
  if (f.archived === true) field.archived = true;
  return { ok: true, value: field };
}

/** Validate a tracker definition from a request body (create or edit). */
export function validateTrackerDefinition(raw: unknown): Result<TrackerDefinition> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 80) return fail('The tracker needs a name (max 80 characters)');
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 1000) : '';
  const category = TRACKER_CATEGORIES.includes(b.category as TrackerCategory) ? (b.category as TrackerCategory) : 'progress';
  const mode: TrackerMode = b.mode === 'sets' ? 'sets' : 'single';
  const preset = typeof b.preset === 'string' && b.preset.length <= 60 ? b.preset : null;
  if (!Array.isArray(b.fields) || b.fields.length === 0) return fail('Add at least one measurement');
  if (b.fields.length > MAX_FIELDS) return fail(`At most ${MAX_FIELDS} measurements per tracker`);
  const seen = new Set<string>();
  const fields: TrackerField[] = [];
  for (const rf of b.fields) {
    const r = cleanField(rf, seen);
    if (!r.ok) return r;
    fields.push(r.value);
  }
  if (!fields.some((f) => !f.computed && !f.archived)) return fail('Add at least one measurement that can be typed in');
  for (const f of fields) {
    if (f.computed === 'bmi' && !(fieldOfKind(fields, 'weight') && fieldOfKind(fields, 'length'))) return fail('BMI needs a weight and a height measurement');
    if (f.computed === 'pace' && !(fieldOfKind(fields, 'duration') && fieldOfKind(fields, 'distance'))) return fail('Pace needs a time and a distance measurement');
    if (f.computed && mode === 'sets') return fail('Calculated measurements are only available for one value per entry');
  }
  return { ok: true, value: { name, description, category, preset, mode, fields } };
}

/** When an existing tracker is edited, a field id that already has history may not change kind. */
export function checkFieldChanges(before: readonly TrackerField[], after: readonly TrackerField[]): string | null {
  for (const old of before) {
    const now = after.find((f) => f.id === old.id);
    if (!now) return `"${old.label}" cannot be removed: archive it instead, so its history stays`;
    if (now.kind !== old.kind) return `"${old.label}" cannot change type once it has history`;
  }
  return null;
}

export const activeFields = (fields: readonly TrackerField[]) => fields.filter((f) => !f.archived);
export const inputFields = (fields: readonly TrackerField[]) => fields.filter((f) => !f.archived && !f.computed);
const fieldOfKind = (fields: readonly TrackerField[], kind: FieldKind) => fields.find((f) => f.kind === kind && !f.computed);

// ── Values ─────────────────────────────────────────────────────────────────────────────────

const LIMITS: Record<FieldKind, [number, number]> = {
  number: [-1e9, 1e9],
  count: [0, 100000],
  weight: [0, 5000],
  length: [0, 100000],
  distance: [0, 100000],
  duration: [0, 1e7],
  speed: [0, 1000],
  percent: [0, 100],
  score: [0, 100],
};

/** Parse what was typed for one field into the stored number (durations to seconds). null = empty. */
export function parseFieldInput(field: Pick<TrackerField, 'kind' | 'unit'>, input: string | number | null | undefined): number | null | 'invalid' {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : 'invalid';
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  if (field.kind === 'duration') {
    if (s.includes(':')) {
      const parts = s.split(':').map((p) => p.trim());
      if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return 'invalid';
      return parts.map(Number).reduce((acc, p) => acc * 60 + p, 0);
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return 'invalid';
    return field.unit === 'h' ? n * 3600 : field.unit === 's' ? n : n * 60;
  }
  const n = Number(s.replace(/%$/, ''));
  return Number.isFinite(n) ? n : 'invalid';
}

function checkValue(field: TrackerField, v: unknown): number | string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `"${field.label}" must be a number`;
  const [lo, hi] = LIMITS[field.kind];
  if (v < lo || v > hi) return `"${field.label}" is out of range`;
  if (field.kind === 'count' && !Number.isInteger(v)) return `"${field.label}" must be a whole number`;
  return Math.round(v * 1000) / 1000;
}

export interface EntryInput {
  entry_date: string;
  measurements: Record<string, number>;
  sets: Array<Record<string, number>> | null;
  note: string;
}

/**
 * Validate an entry against its tracker. Values are numbers already in stored units
 * (the page converts with parseFieldInput). Unknown, archived or calculated fields are refused.
 */
export function validateEntry(tracker: Pick<TrackerDefinition, 'mode' | 'fields'>, raw: unknown, today: string): Result<EntryInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const entry_date = typeof b.entry_date === 'string' && b.entry_date ? b.entry_date : today;
  if (!DATE.test(entry_date) || Number.isNaN(Date.parse(entry_date))) return fail('The date must be YYYY-MM-DD');
  if (entry_date < '1900-01-01' || entry_date > addDays(today, 1)) return fail('The date cannot be in the future');
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) : '';
  const byId = new Map(inputFields(tracker.fields).map((f) => [f.id, f]));

  const cleanRecord = (rec: unknown): Result<Record<string, number>> => {
    if (rec === null || rec === undefined) return { ok: true, value: {} };
    if (typeof rec !== 'object' || Array.isArray(rec)) return fail('Measurements must be an object');
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue;
      const f = byId.get(k);
      if (!f) return fail(`Unknown measurement "${k}"`);
      const c = checkValue(f, v);
      if (typeof c === 'string') return fail(c);
      out[k] = c;
    }
    return { ok: true, value: out };
  };

  if (tracker.mode === 'sets') {
    if (!Array.isArray(b.sets)) return fail('Add at least one set');
    if (b.sets.length > MAX_SETS) return fail(`At most ${MAX_SETS} sets`);
    const sets: Array<Record<string, number>> = [];
    for (const s of b.sets) {
      const r = cleanRecord(s);
      if (!r.ok) return r;
      if (Object.keys(r.value).length) sets.push(r.value);
    }
    if (!sets.length) return fail('Add at least one set with a value');
    return { ok: true, value: { entry_date, measurements: {}, sets, note } };
  }
  const r = cleanRecord(b.measurements);
  if (!r.ok) return r;
  if (!Object.keys(r.value).length) return fail('Enter at least one measurement');
  return { ok: true, value: { entry_date, measurements: r.value, sets: null, note } };
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Calculated measurements ────────────────────────────────────────────────────────────────

const toKg = (v: number, unit: string) => (unit === 'lb' ? v * 0.45359237 : v);
const toMeters = (v: number, unit: string) => (unit === 'm' ? v : unit === 'in' ? v * 0.0254 : v / 100);
const toKm = (v: number, unit: string) => (unit === 'm' ? v / 1000 : unit === 'mi' ? v * 1.609344 : v);

const byDate = (a: TrackerEntry, b: TrackerEntry) =>
  a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;

/**
 * Values of calculated fields per entry id. BMI uses the entry's weight and the most recent
 * height on or before that date (height is measured rarely), else the nearest later height.
 * Pace = time / distance, in seconds per km.
 */
export function computeDerived(tracker: Pick<TrackerDefinition, 'fields' | 'mode'>, entries: readonly TrackerEntry[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (tracker.mode !== 'single') return out;
  const computed = tracker.fields.filter((f) => f.computed);
  if (!computed.length) return out;
  const sorted = [...entries].sort(byDate);
  const weightF = fieldOfKind(tracker.fields, 'weight');
  const heightF = fieldOfKind(tracker.fields, 'length');
  const timeF = fieldOfKind(tracker.fields, 'duration');
  const distF = fieldOfKind(tracker.fields, 'distance');
  const heights = heightF ? sorted.filter((e) => typeof e.measurements[heightF.id] === 'number' && e.measurements[heightF.id] > 0) : [];
  for (const e of sorted) {
    const vals: Record<string, number> = {};
    for (const f of computed) {
      if (f.computed === 'bmi' && weightF && heightF) {
        const w = e.measurements[weightF.id];
        if (typeof w !== 'number' || w <= 0) continue;
        const before = heights.filter((h) => h.entry_date <= e.entry_date);
        const h = before.length ? before[before.length - 1] : heights[0];
        if (!h) continue;
        const m = toMeters(h.measurements[heightF.id], heightF.unit);
        if (m <= 0.5 || m > 3) continue;
        vals[f.id] = Math.round((toKg(w, weightF.unit) / (m * m)) * 10) / 10;
      }
      if (f.computed === 'pace' && timeF && distF) {
        const t = e.measurements[timeF.id];
        const d = e.measurements[distF.id];
        if (typeof t !== 'number' || typeof d !== 'number' || t <= 0 || d <= 0) continue;
        vals[f.id] = Math.round(t / toKm(d, distF.unit));
      }
    }
    if (Object.keys(vals).length) out.set(e.id, vals);
  }
  return out;
}

// ── Series for charts (adapts to the measurement) ─────────────────────────────────────────

export interface SeriesPoint { date: string; value: number; entryId: string; pending: boolean }
export interface Series {
  key: string;
  label: string;
  kind: FieldKind;
  unit: string;
  better: Better;
  points: SeriesPoint[];
}

/** Entries that belong on a chart: approved ones and player submissions waiting for review. */
export const chartable = (e: TrackerEntry) => e.status !== 'needs_revision';

/**
 * Chartable series for a tracker. One value per entry: one series per measurement (calculated
 * ones included). Sets: per measurement the best set, the total for counts and times, the
 * training volume (reps × weight) when both exist, and the number of sets.
 */
export function buildSeries(tracker: Pick<TrackerDefinition, 'fields' | 'mode'>, entries: readonly TrackerEntry[]): Series[] {
  const sorted = [...entries].filter(chartable).sort(byDate);
  const fields = activeFields(tracker.fields);
  const series: Series[] = [];
  const pt = (e: TrackerEntry, value: number): SeriesPoint => ({ date: e.entry_date, value, entryId: e.id, pending: e.status === 'submitted' });

  if (tracker.mode === 'single') {
    const derived = computeDerived(tracker, sorted);
    for (const f of fields) {
      const points: SeriesPoint[] = [];
      for (const e of sorted) {
        const v = f.computed ? derived.get(e.id)?.[f.id] : e.measurements[f.id];
        if (typeof v === 'number') points.push(pt(e, v));
      }
      series.push({ key: f.id, label: f.label, kind: f.kind, unit: f.unit, better: f.better ?? (f.computed === 'pace' ? 'lower' : null), points });
    }
    return series;
  }

  const sets = (e: TrackerEntry) => e.sets ?? [];
  const countF = fields.find((f) => f.kind === 'count');
  const weightF = fields.find((f) => f.kind === 'weight');
  for (const f of fields) {
    const best: SeriesPoint[] = [];
    const total: SeriesPoint[] = [];
    for (const e of sorted) {
      const vals = sets(e).map((s) => s[f.id]).filter((v): v is number => typeof v === 'number');
      if (!vals.length) continue;
      best.push(pt(e, f.better === 'lower' ? Math.min(...vals) : Math.max(...vals)));
      total.push(pt(e, Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000));
    }
    const bestLabel = f.kind === 'weight' ? `Top ${f.label.toLowerCase()}` : `Best set (${f.label.toLowerCase()})`;
    series.push({ key: `${f.id}:best`, label: bestLabel, kind: f.kind, unit: f.unit, better: f.better ?? 'higher', points: best });
    if (f.kind === 'count' || f.kind === 'duration' || f.kind === 'distance') {
      series.push({ key: `${f.id}:total`, label: `Total ${f.label.toLowerCase()}`, kind: f.kind, unit: f.unit, better: f.better ?? 'higher', points: total });
    }
  }
  if (countF && weightF) {
    const vol: SeriesPoint[] = [];
    for (const e of sorted) {
      const v = sets(e).reduce((acc, s) => acc + (typeof s[countF.id] === 'number' && typeof s[weightF.id] === 'number' ? s[countF.id] * s[weightF.id] : 0), 0);
      if (v > 0) vol.push(pt(e, Math.round(v * 10) / 10));
    }
    series.push({ key: 'volume', label: `Volume (${countF.label.toLowerCase()} × ${weightF.label.toLowerCase()})`, kind: 'weight', unit: weightF.unit, better: 'higher', points: vol });
  }
  series.push({ key: 'sets', label: 'Sets', kind: 'count', unit: 'sets', better: 'higher', points: sorted.filter((e) => sets(e).length).map((e) => pt(e, sets(e).length)) });
  return series;
}

/** The series shown first: the most telling one for the tracker. */
export function defaultSeriesKey(tracker: Pick<TrackerDefinition, 'fields' | 'mode'>, series: readonly Series[]): string | null {
  const withData = series.filter((s) => s.points.length);
  if (!withData.length) return series[0]?.key ?? null;
  if (tracker.mode === 'sets') {
    const pick = withData.find((s) => s.kind === 'weight' && s.key.endsWith(':best'))
      ?? withData.find((s) => s.key.endsWith(':total') && s.kind === 'count')
      ?? withData.find((s) => s.key.endsWith(':best'));
    return (pick ?? withData[0]).key;
  }
  const order: FieldKind[] = ['weight', 'duration', 'distance', 'count', 'percent', 'length', 'speed', 'score', 'number'];
  const typed = withData.filter((s) => tracker.fields.find((f) => f.id === s.key && !f.computed));
  for (const k of order) {
    const s = typed.find((x) => x.kind === k);
    if (s) return s.key;
  }
  return withData[0].key;
}

/** First vs latest point, and whether that is an improvement (when the field says which way is better). */
export function seriesChange(s: Series): { first: number; latest: number; delta: number; improved: boolean | null } | null {
  if (s.points.length < 2) return null;
  const first = s.points[0].value;
  const latest = s.points[s.points.length - 1].value;
  const delta = Math.round((latest - first) * 1000) / 1000;
  const improved = s.better === null || delta === 0 ? null : s.better === 'higher' ? delta > 0 : delta < 0;
  return { first, latest, delta, improved };
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────

export function formatDuration(totalSeconds: number): string {
  const neg = totalSeconds < 0;
  let s = Math.round(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

const trim = (n: number) => String(Math.round(n * 100) / 100);

/** A value as people read it: "24:30", "72.5 kg", "18 %", "12 reps", "8/10". */
export function formatValue(value: number, kind: FieldKind, unit: string, opts: { computed?: Computed | null } = {}): string {
  if (opts.computed === 'pace') return `${formatDuration(value)} /km`;
  if (kind === 'duration') return formatDuration(value);
  if (kind === 'percent') return `${trim(value)} %`;
  if (kind === 'score') return `${trim(value)}${unit || ''}`;
  return unit ? `${trim(value)} ${unit}` : trim(value);
}

/** Format a value for an <input> so it round-trips through parseFieldInput. */
export function inputValue(value: number | undefined, field: Pick<TrackerField, 'kind'>): string {
  if (typeof value !== 'number') return '';
  return field.kind === 'duration' ? formatDuration(value) : trim(value);
}

/** One line describing an entry: "3 sets: 12 × 40 kg, 12 × 40 kg, 10 × 40 kg" or "Weight 72 kg · Fat 14 %". */
export function describeEntry(tracker: Pick<TrackerDefinition, 'fields' | 'mode'>, e: Pick<TrackerEntry, 'measurements' | 'sets'>, derived?: Record<string, number>): string {
  const fields = tracker.fields;
  if (tracker.mode === 'sets') {
    const sets = e.sets ?? [];
    const one = (s: Record<string, number>) => fields
      .filter((f) => typeof s[f.id] === 'number')
      .map((f) => (f.kind === 'count' ? trim(s[f.id]) : formatValue(s[f.id], f.kind, f.unit)))
      .join(' × ');
    return `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}: ${sets.map(one).join(', ')}`;
  }
  return fields
    .map((f) => {
      const v = f.computed ? derived?.[f.id] : e.measurements[f.id];
      return typeof v === 'number' ? `${f.label} ${formatValue(v, f.kind, f.unit, { computed: f.computed })}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}
