/**
 * Technical Sheet — per-player editable rows shown in the profile.
 *
 * Coaches can add custom rows and delete rows. Structural changes (add /
 * delete) also update the coach's default template (coach_settings), which is
 * applied to NEW players only — existing players keep their current rows.
 */

export interface TechnicalSheetRow {
  label: string;
  value: string;
}

export const DEFAULT_TECHNICAL_SHEET_LABELS = [
  'Age',
  'Height',
  'Weight',
  'Dominant Hand',
  'Backhand',
  'Strengths',
  'Weaknesses',
  'Level',
  // Added with the grouped profile layout. They only reach NEW players of a coach who has not
  // saved a template of their own; everyone else gets them as one-tap suggestions
  // (`missingSuggestions`), which add a row and never touch an existing one.
  'UTR',
  'Diet',
  'Exercise plan',
  'Goals',
] as const;

/** The labels the profile offers as suggestions to players whose sheet does not have them yet. */
export const SUGGESTED_LABELS = ['UTR', 'Diet', 'Exercise plan', 'Goals'] as const;

export function defaultTechnicalSheet(labels?: string[]): TechnicalSheetRow[] {
  const source = labels?.length ? labels : [...DEFAULT_TECHNICAL_SHEET_LABELS];
  return source.map((label) => ({ label, value: '' }));
}

/** Normalize unknown JSON from the DB into rows (drops malformed entries). */
export function parseTechnicalSheet(raw: unknown): TechnicalSheetRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: TechnicalSheetRow[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { label?: unknown }).label === 'string') {
      rows.push({
        label: (item as { label: string }).label,
        value: typeof (item as { value?: unknown }).value === 'string' ? (item as { value: string }).value : '',
      });
    }
  }
  return rows;
}

// ── Grouped profile layout (REPORTS_IN_APP) ──────────────────────────────────
// The sheet stays a flat list of { label, value } rows in the database; the groups are made
// from the labels when the page is drawn, so no schema change is needed.

export type SheetGroupId = 'body' | 'game' | 'lifestyle' | 'other';

/** A row together with its position in the full sheet, so an edit goes back to the right row. */
export interface IndexedRow {
  index: number;
  row: TechnicalSheetRow;
}

/** Labels compare without case, outer spaces or repeated spaces ("Exercise  Plan" = "exercise plan"). */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

const GROUP_OF: Record<string, SheetGroupId> = {
  age: 'body',
  height: 'body',
  weight: 'body',
  'dominant hand': 'game',
  backhand: 'game',
  level: 'game',
  utr: 'game',
  strengths: 'game',
  weaknesses: 'game',
  diet: 'lifestyle',
  'exercise plan': 'lifestyle',
  goals: 'lifestyle',
};

/** Labels whose value is a sentence or a list, shown as a text box under the label. */
const LONG_LABELS = new Set(['strengths', 'weaknesses', 'diet', 'exercise plan', 'goals']);

export function isLongLabel(label: string): boolean {
  return LONG_LABELS.has(normalizeLabel(label));
}

export function groupOfLabel(label: string): SheetGroupId {
  return GROUP_OF[normalizeLabel(label)] ?? 'other';
}

/** Splits the rows into the four groups, each in the sheet's own order, nothing dropped or repeated. */
export function groupSheetRows(rows: readonly TechnicalSheetRow[]): Record<SheetGroupId, IndexedRow[]> {
  const out: Record<SheetGroupId, IndexedRow[]> = { body: [], game: [], lifestyle: [], other: [] };
  rows.forEach((row, index) => out[groupOfLabel(row.label)].push({ index, row }));
  return out;
}

/** The first row with this label (any case), or undefined. */
export function findRow(rows: readonly TechnicalSheetRow[], label: string): TechnicalSheetRow | undefined {
  const want = normalizeLabel(label);
  return rows.find((r) => normalizeLabel(r.label) === want);
}

/** A row's text, trimmed; '' when there is no such row. */
export function rowValue(rows: readonly TechnicalSheetRow[], label: string): string {
  return findRow(rows, label)?.value.trim() ?? '';
}

/**
 * Age in whole years on `now`, from a date of birth like "2009-03-14" (or an ISO timestamp).
 * Null when there is no date, it cannot be read, it lies in the future, or it gives more than 120 years.
 * Compared by calendar date, so the birthday itself counts.
 */
export function ageFromDob(dob: string | null | undefined, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dob ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Reject 2009-02-31 and the like: the date has to exist.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  let age = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

/** Which of the suggested rows (UTR, Diet, Exercise plan, Goals) this sheet does not have yet. */
export function missingSuggestions(rows: readonly TechnicalSheetRow[]): string[] {
  return SUGGESTED_LABELS.filter((label) => !findRow(rows, label));
}

/** Adds an empty row with this label at the end, unless the label is already there. Never changes an existing row. */
export function addRowIfMissing(rows: readonly TechnicalSheetRow[], label: string): TechnicalSheetRow[] {
  const clean = label.trim();
  if (!clean || findRow(rows, clean)) return [...rows];
  return [...rows, { label: clean, value: '' }];
}

/** True when the two sheets have different labels (a row was added, removed or renamed): then the coach's template follows. */
export function labelsChanged(a: readonly TechnicalSheetRow[], b: readonly TechnicalSheetRow[]): boolean {
  return a.length !== b.length || a.some((r, i) => r.label !== b[i].label);
}
