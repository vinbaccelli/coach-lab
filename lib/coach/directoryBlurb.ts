/**
 * The short blurb shown on a coach's card in the /coaches directory.
 *
 * STORAGE: the existing `coach_profiles.tagline` column. No migration — that
 * column already exists in production, is already saved by
 * `PUT /api/coach-profile`, and is already what `app/coaches/page.tsx` renders
 * under each coach's name. What was missing was framing (it was labelled
 * "Tagline" and sized for one line) and a curated fallback, not storage.
 *
 * Same precedence as bio lines and the avatar: a value the coach saved wins,
 * and curated content is the fallback.
 */

/** Roughly three lines at directory-card width. */
export const MAX_DIRECTORY_BLURB = 200;

/**
 * Below this, the stored value is a leftover one-line TAGLINE, not a blurb.
 *
 * The column used to be labelled "Tagline" and was sized for one line, so real
 * rows carry things like "Tennis coach". Treating those as blurbs would show a
 * two-word card and permanently hide the curated fallback, so the same
 * quality-guard idea as `parseBioLines` applies: accept the stored value only
 * when it actually is the thing it is standing in for.
 */
export const MIN_DIRECTORY_BLURB = 40;

/**
 * Trim a stored blurb, returning null when there is nothing usable — empty, or
 * too short to be anything but a legacy tagline.
 */
export function parseDirectoryBlurb(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text.length < MIN_DIRECTORY_BLURB) return null;
  return text.length > MAX_DIRECTORY_BLURB ? text.slice(0, MAX_DIRECTORY_BLURB).trimEnd() : text;
}
