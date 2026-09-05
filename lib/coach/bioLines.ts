/**
 * Bio lines — the short, ordered lines shown under a coach's name.
 *
 * STORAGE: there is no `bio_lines` column. Verified against the production
 * `coach_profiles` table on 2026-09-05, whose columns are exactly: id, user_id,
 * slug, name, tagline, bio, avatar_url, accent_color, created_at, updated_at.
 * So the lines are persisted in the EXISTING `bio` text column, newline
 * separated, which needs no migration and no API change — `bio` is already read
 * by the profile route and already written by `PUT /api/coach-profile`.
 *
 * WHY THE GUARD: `bio` is free text and has held bad data. The production
 * `vinbaccelli` row currently contains a 16,000-character pasted HTML document
 * (docs/KNOWN_ISSUES.md 003), which naive splitting would render as hundreds of
 * junk lines. `parseBioLines` therefore accepts a stored bio as bio lines only
 * when it actually reads like one, and returns null otherwise so callers can
 * fall back or warn instead of showing garbage.
 */

/** A bio is a handful of short lines, not a document. */
export const MAX_BIO_LINES = 12;
export const MAX_BIO_LINE_LENGTH = 160;

/** Looks like an HTML/XML tag — the signature of pasted markup. */
const MARKUP = /<[a-z!/][^>]*>/i;

/**
 * Parse a stored `bio` into ordered bio lines.
 * Returns null when the stored value is empty or does not read like bio lines.
 */
export function parseBioLines(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_BIO_LINES) return null;
  if (lines.some(l => l.length > MAX_BIO_LINE_LENGTH)) return null;
  if (lines.some(l => MARKUP.test(l))) return null;
  return lines;
}

/** Serialise bio lines back into the `bio` column. */
export function serializeBioLines(lines: string[]): string {
  return lines.map(l => l.trim()).filter(Boolean).join('\n');
}
