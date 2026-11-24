/**
 * Technical Sheet — per-player editable rows shown in the profile.
 *
 * Coaches can add custom rows and delete rows. Structural changes (add /
 * delete) also update the coach's default template (coach_settings), which is
 * applied to NEW players only — existing players keep their current rows.
 */

/** One dated comment on a progress tracking row ("Jan 1: forehand was late…"). */
export interface TrackEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
}

export interface TechnicalSheetRow {
  label: string;
  value: string;
  /** 'track' = a progress tracking row (dated comments over time); absent = a plain value row. */
  kind?: 'track';
  entries?: TrackEntry[];
}

/** The standard rows of a new player's sheet: all progress tracking rows. */
export const STANDARD_TRACKING_LABELS = ['Forehand', 'Backhand', 'Serve', 'Volley', 'Footwork'] as const;
export const DEFAULT_TECHNICAL_SHEET_LABELS = STANDARD_TRACKING_LABELS;

const isStandardTracking = (label: string) => STANDARD_TRACKING_LABELS.some((l) => l.toLowerCase() === label.trim().toLowerCase());

/** A new row of the given kind. */
export function makeRow(label: string, kind: 'text' | 'track'): TechnicalSheetRow {
  return kind === 'track' ? { label, value: '', kind: 'track', entries: [] } : { label, value: '' };
}

/** A new player's sheet: the coach's saved labels if any (the five standard names stay tracking rows), else the standard five. */
export function defaultTechnicalSheet(labels?: string[]): TechnicalSheetRow[] {
  const source = labels?.length ? labels : [...DEFAULT_TECHNICAL_SHEET_LABELS];
  return source.map((label) => makeRow(label, isStandardTracking(label) ? 'track' : 'text'));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TRACK_ENTRIES = 500;
export const MAX_TRACK_TEXT = 2000;

/** Add a dated comment to a tracking row (returns a new row; a bad date or empty text changes nothing). */
export function addTrackEntry(row: TechnicalSheetRow, date: string, text: string, id: string): TechnicalSheetRow {
  const t = text.trim().slice(0, MAX_TRACK_TEXT);
  const entries = row.entries ?? [];
  if (!t || !DATE_RE.test(date) || entries.length >= MAX_TRACK_ENTRIES) return row;
  return { ...row, kind: 'track', entries: [...entries, { id, date, text: t }] };
}

export function removeTrackEntry(row: TechnicalSheetRow, id: string): TechnicalSheetRow {
  return { ...row, entries: (row.entries ?? []).filter((e) => e.id !== id) };
}

/** Newest first (same date: the one added later first). Does not change the stored order. */
export function entriesNewestFirst(row: TechnicalSheetRow): TrackEntry[] {
  const list = row.entries ?? [];
  return list.map((e, i) => ({ e, i })).sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : b.i - a.i)).map((x) => x.e);
}

function parseEntries(raw: unknown): TrackEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackEntry[] = [];
  for (const x of raw) {
    const o = x as Partial<TrackEntry> | null;
    if (o && typeof o.id === 'string' && typeof o.text === 'string' && typeof o.date === 'string' && DATE_RE.test(o.date)) {
      out.push({ id: o.id.slice(0, 64), date: o.date, text: o.text.slice(0, MAX_TRACK_TEXT) });
    }
    if (out.length >= MAX_TRACK_ENTRIES) break;
  }
  return out;
}

/** Normalize unknown JSON from the DB into rows (drops malformed entries). */
export function parseTechnicalSheet(raw: unknown): TechnicalSheetRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: TechnicalSheetRow[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { label?: unknown }).label === 'string') {
      const it = item as { label: string; value?: unknown; kind?: unknown; entries?: unknown };
      const base = { label: it.label, value: typeof it.value === 'string' ? it.value : '' };
      rows.push(it.kind === 'track' ? { ...base, kind: 'track', entries: parseEntries(it.entries) } : base);
    }
  }
  return rows;
}

/** The sheet every player used to start with (before the standard tracking rows). */
export const OLD_DEFAULT_LABELS = ['Age', 'Height', 'Weight', 'Dominant Hand', 'Backhand', 'Strengths', 'Weaknesses', 'Level'] as const;

/** Is this still the untouched old default sheet (those rows in any order, nothing typed in)? */
export function isUntouchedOldDefault(rows: readonly TechnicalSheetRow[]): boolean {
  if (rows.length !== OLD_DEFAULT_LABELS.length) return false;
  const want = new Set<string>(OLD_DEFAULT_LABELS);
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'track' || r.value.trim() !== '' || !want.has(r.label) || seen.has(r.label)) return false;
    seen.add(r.label);
  }
  return true;
}

/** An untouched old default becomes the standard tracking rows; any other sheet is returned as it is. */
export function migrateOldDefault(rows: TechnicalSheetRow[]): TechnicalSheetRow[] {
  return isUntouchedOldDefault(rows) ? defaultTechnicalSheet() : rows;
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Is `label` already a row on this sheet (ignoring case and spaces)? */
export const labelTaken = (rows: readonly TechnicalSheetRow[], label: string) => rows.some((r) => sameLabel(r.label, label));

/**
 * The standard sheet, keeping what the coach wrote: the five standard tracking rows first (an existing tracking
 * row keeps its entries; a plain row of the same name that has text becomes its first entry, dated `today`),
 * then every other plain row that has something typed in, then any other tracking row. Empty plain rows go.
 */
export function resetToStandard(rows: readonly TechnicalSheetRow[], today: string, newId: () => string): TechnicalSheetRow[] {
  const out: TechnicalSheetRow[] = [];
  const used = new Set<number>();
  for (const label of STANDARD_TRACKING_LABELS) {
    const idx = rows.findIndex((r, i) => !used.has(i) && sameLabel(r.label, label) && r.kind === 'track');
    if (idx >= 0) { used.add(idx); out.push(rows[idx]); continue; }
    let row = makeRow(label, 'track');
    const plain = rows.findIndex((r, i) => !used.has(i) && sameLabel(r.label, label) && r.kind !== 'track');
    if (plain >= 0) {
      used.add(plain);
      row = addTrackEntry(row, today, rows[plain].value, newId());
    }
    out.push(row);
  }
  rows.forEach((r, i) => {
    if (used.has(i)) return;
    if (r.kind === 'track' || r.value.trim() !== '') out.push(r);
  });
  return out;
}

/** Does the sheet differ from the standard one in a way "Reset to standard rows" would change? */
export function needsReset(rows: readonly TechnicalSheetRow[]): boolean {
  if (STANDARD_TRACKING_LABELS.some((l) => !rows.some((r) => r.kind === 'track' && sameLabel(r.label, l)))) return true;
  return rows.some((r) => r.kind !== 'track' && r.value.trim() === '');
}
