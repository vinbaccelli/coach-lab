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
] as const;

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
