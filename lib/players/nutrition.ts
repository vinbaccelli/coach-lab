/**
 * Nutrition: pure logic for versioned plans and the meal diary (API routes and pages share it).
 *
 * A plan covers a period [starts_on, ends_on] (open-ended when ends_on is null). A new version is a
 * new plan that starts on a date; the plan it replaces is closed the day before, never edited, so
 * January's plan stays exactly what it was. A plan whose period has ended is history (read-only).
 */

export const MEAL_CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout', 'other'] as const;
export type MealCategory = (typeof MEAL_CATEGORIES)[number];
export const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
  pre_workout: 'Before training', post_workout: 'After training', other: 'Other',
};

export interface CustomTarget { id: string; label: string; unit: string; target: number | null }
export interface PlanTargets {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  custom: CustomTarget[];
}
export interface MealRecommendation { id: string; name: string; time: string; description: string }

export interface NutritionPlanInput {
  title: string;
  starts_on: string;
  ends_on: string | null;
  status: 'draft' | 'active' | 'archived';
  targets: PlanTargets;
  meals: MealRecommendation[];
  notes: string;
}
export interface NutritionPlan extends NutritionPlanInput {
  id: string;
  player_id: string;
  previous_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MealInput {
  eaten_on: string;
  eaten_at: string | null;
  category: MealCategory;
  description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  extras: Record<string, number>;
  photo_url: string | null;
  note: string;
}
export type MealStatus = 'submitted' | 'approved' | 'needs_revision';
export interface MealLog extends MealInput {
  id: string;
  author: 'coach' | 'link';
  /** Meals the player logs through the share link wait for the coach (submitted); coach meals are approved. */
  status: MealStatus;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const isYmd = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isDate = isYmd;

/** A date shifted by n days (YYYY-MM-DD, no time-zone drift). */
export function shiftDay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function num(v: unknown, max: number): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) return 'bad';
  return Math.round(n * 10) / 10;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'target';

/** Validate a plan from a request body. */
export function validatePlan(raw: unknown): Result<NutritionPlanInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 120) return fail('The plan needs a name (max 120 characters)');
  if (!isDate(b.starts_on)) return fail('Choose a start date');
  const ends_on = b.ends_on === null || b.ends_on === undefined || b.ends_on === '' ? null : b.ends_on;
  if (ends_on !== null && (!isDate(ends_on) || ends_on < b.starts_on)) return fail('The end date must be on or after the start date');
  const status = b.status === 'draft' || b.status === 'archived' ? b.status : 'active';
  const t = (b.targets ?? {}) as Record<string, unknown>;
  const targets: PlanTargets = { calories: null, protein_g: null, carbs_g: null, fat_g: null, custom: [] };
  for (const [k, max] of [['calories', 20000], ['protein_g', 2000], ['carbs_g', 2000], ['fat_g', 2000]] as const) {
    const n = num(t[k], max);
    if (n === 'bad') return fail(`The ${k === 'calories' ? 'calorie' : k.replace('_g', '')} target must be a number`);
    targets[k] = n;
  }
  const seen = new Set<string>();
  for (const c of Array.isArray(t.custom) ? t.custom.slice(0, 10) : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 40) : '';
    if (!label) continue;
    let id = typeof o.id === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(o.id) ? o.id : slug(label);
    for (let i = 2; seen.has(id); i++) id = `${slug(label)}_${i}`;
    seen.add(id);
    const target = num(o.target, 1e6);
    if (target === 'bad') return fail(`The target for ${label} must be a number`);
    targets.custom.push({ id, label, unit: typeof o.unit === 'string' ? o.unit.trim().slice(0, 12) : '', target });
  }
  const meals: MealRecommendation[] = [];
  for (const m of Array.isArray(b.meals) ? b.meals.slice(0, 20) : []) {
    const o = (m ?? {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '';
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, 1000) : '';
    if (!name && !description) continue;
    meals.push({
      id: typeof o.id === 'string' && o.id.length <= 64 ? o.id : `m${meals.length + 1}`,
      name: name || 'Meal',
      time: typeof o.time === 'string' && TIME.test(o.time) ? o.time.slice(0, 5) : '',
      description,
    });
  }
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 4000) : '';
  return { ok: true, value: { title, starts_on: b.starts_on, ends_on, status, targets, meals, notes } };
}

/** Calories from macros (4 kcal/g protein and carbs, 9 kcal/g fat), or null when no macro is known. */
export function caloriesFromMacros(p: number | null, c: number | null, f: number | null): number | null {
  if (p === null && c === null && f === null) return null;
  return Math.round((p ?? 0) * 4 + (c ?? 0) * 4 + (f ?? 0) * 9);
}

/**
 * Validate a meal. Empty calories are calculated from the macros when any macro is given.
 * `today` is the server's (UTC) date: one day of slack lets a player east of UTC log today's meal.
 * `opts.photo` says a photo comes with the request (uploaded by the route), which is enough to log.
 */
export function validateMeal(raw: unknown, today: string, customIds: readonly string[] = [], opts: { photo?: boolean } = {}): Result<MealInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const eaten_on = isDate(b.eaten_on) ? b.eaten_on : today;
  if (eaten_on > shiftDay(today, 1) || eaten_on < '1900-01-01') return fail('The date cannot be in the future');
  const eaten_at = typeof b.eaten_at === 'string' && TIME.test(b.eaten_at) ? b.eaten_at.slice(0, 5) : null;
  const category = MEAL_CATEGORIES.includes(b.category as MealCategory) ? (b.category as MealCategory) : 'other';
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 1000) : '';
  const vals: Record<'calories' | 'protein_g' | 'carbs_g' | 'fat_g', number | null> = { calories: null, protein_g: null, carbs_g: null, fat_g: null };
  for (const [k, max] of [['calories', 20000], ['protein_g', 2000], ['carbs_g', 2000], ['fat_g', 2000]] as const) {
    const n = num(b[k], max);
    if (n === 'bad') return fail(`${k === 'calories' ? 'Calories' : k.replace('_g', '').replace(/^./, (x) => x.toUpperCase())} must be a number`);
    vals[k] = n;
  }
  if (vals.calories === null) vals.calories = caloriesFromMacros(vals.protein_g, vals.carbs_g, vals.fat_g);
  const extras: Record<string, number> = {};
  const rawExtras = (b.extras && typeof b.extras === 'object' ? b.extras : {}) as Record<string, unknown>;
  for (const id of customIds) {
    const n = num(rawExtras[id], 1e6);
    if (n === 'bad') return fail('A custom value must be a number');
    if (n !== null) extras[id] = n;
  }
  const photo_url = typeof b.photo_url === 'string' && /^https?:\/\//.test(b.photo_url) ? b.photo_url.slice(0, 1000) : null;
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
  if (!description && vals.calories === null && !photo_url && !opts.photo) return fail('Describe the meal, add its calories or a photo');
  return { ok: true, value: { eaten_on, eaten_at, category, description, ...vals, extras, photo_url, note } };
}

/** Plans in force on a date: the active one with the latest start whose period covers the date. */
export function planForDate<T extends Pick<NutritionPlan, 'starts_on' | 'ends_on' | 'status'>>(plans: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const p of plans) {
    if (p.status !== 'active') continue;
    if (p.starts_on > date) continue;
    if (p.ends_on !== null && p.ends_on < date) continue;
    if (!best || p.starts_on > best.starts_on) best = p;
  }
  return best;
}

/** History = the period ended before today. A plan in its period, or starting later, can be edited. */
export const isHistory = (p: Pick<NutritionPlan, 'ends_on'>, today: string) => p.ends_on !== null && p.ends_on < today;

/** The day before a date (for closing the plan a new version replaces). */
export const dayBefore = (ymd: string): string => shiftDay(ymd, -1);

/**
 * What a new version starting on `newStart` does to the plan it replaces: its end becomes the day
 * before (if it was open-ended or ended later). A version cannot start on or before the old start.
 */
export function closeForVersion(old: Pick<NutritionPlan, 'starts_on' | 'ends_on'>, newStart: string): Result<{ ends_on: string }> {
  if (!isDate(newStart)) return fail('Choose the date the new version starts');
  if (newStart <= old.starts_on) return fail('The new version must start after the current one starts');
  const end = dayBefore(newStart);
  return { ok: true, value: { ends_on: old.ends_on !== null && old.ends_on < end ? old.ends_on : end } };
}

export interface DayTotals { calories: number; protein_g: number; carbs_g: number; fat_g: number; extras: Record<string, number>; meals: number }

export function dayTotals(meals: readonly Pick<MealLog, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'extras'>[]): DayTotals {
  const t: DayTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, extras: {}, meals: meals.length };
  for (const m of meals) {
    t.calories += m.calories ?? 0;
    t.protein_g += m.protein_g ?? 0;
    t.carbs_g += m.carbs_g ?? 0;
    t.fat_g += m.fat_g ?? 0;
    for (const [k, v] of Object.entries(m.extras ?? {})) t.extras[k] = (t.extras[k] ?? 0) + v;
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  return { ...t, calories: Math.round(t.calories), protein_g: r(t.protein_g), carbs_g: r(t.carbs_g), fat_g: r(t.fat_g) };
}

/** Each target with what was eaten and the share of the target (null when there is no target). */
export function compareToTargets(t: DayTotals, targets: PlanTargets | null) {
  const row = (key: string, label: string, unit: string, value: number, target: number | null) =>
    ({ key, label, unit, value, target, pct: target ? Math.round((value / target) * 100) : null });
  const out = [
    row('calories', 'Calories', 'kcal', t.calories, targets?.calories ?? null),
    row('protein_g', 'Protein', 'g', t.protein_g, targets?.protein_g ?? null),
    row('carbs_g', 'Carbs', 'g', t.carbs_g, targets?.carbs_g ?? null),
    row('fat_g', 'Fat', 'g', t.fat_g, targets?.fat_g ?? null),
  ];
  for (const c of targets?.custom ?? []) out.push(row(c.id, c.label, c.unit, t.extras[c.id] ?? 0, c.target));
  return out;
}

/** A sensible meal category for the time of day (so logging a meal is one less tap). */
export function categoryForHour(h: number): MealCategory {
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 18 && h < 22) return 'dinner';
  return 'snack';
}

/** The meal days a request asks for: `to` defaults to today, `from` to a week before; at most 62 days. */
export const MAX_RANGE_DAYS = 62;
export function mealRange(from: unknown, to: unknown, today: string): { from: string; to: string } {
  const t = isDate(to) ? to : today;
  let f = isDate(from) ? from : shiftDay(t, -6);
  if (f > t) f = t;
  if (shiftDay(f, MAX_RANGE_DAYS) < t) f = shiftDay(t, -MAX_RANGE_DAYS);
  return { from: f, to: t };
}

/** Every custom value a meal may carry: the custom targets of the player's plans. */
export function customIdsOf(plans: readonly { targets?: unknown }[]): string[] {
  const ids = new Set<string>();
  for (const p of plans) {
    const custom = (p.targets as Partial<PlanTargets> | null)?.custom;
    if (Array.isArray(custom)) for (const c of custom) if (c && typeof c.id === 'string') ids.add(c.id);
  }
  return [...ids];
}

/** The player sees the coach's active plans only (not drafts, not archived ones). */
export const planVisibleToPlayer = (p: Pick<NutritionPlan, 'status'>) => p.status === 'active';

/** Through the link the player can change only their own meals, and only until the coach approved them. */
export const playerCanChangeMeal = (m: Pick<MealLog, 'author' | 'status'>) => m.author === 'link' && m.status !== 'approved';
