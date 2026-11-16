/**
 * Suggested profile fields for the player's sheet. Suggestions are offered as one-tap chips;
 * nothing is added unless the user taps one, so no category is forced on anybody.
 */

export const SUGGESTED_FIELD_LABELS = [
  'Nutrition plan',
  'Injuries',
  'Goals',
  'Club / academy',
  'Racket and strings',
  'Fitness notes',
  'Mental notes',
  'Parent / guardian contact',
] as const;

/** Suggestions not already present (case-insensitive, trimmed) on the sheet. */
export function suggestionsFor(existingLabels: readonly string[]): string[] {
  const have = new Set(existingLabels.map((l) => l.trim().toLowerCase()));
  return SUGGESTED_FIELD_LABELS.filter((s) => !have.has(s.toLowerCase()));
}
