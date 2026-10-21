/**
 * Which range the toolbar AI Track offers: the timeline's green section when one
 * is set (the same section the Metrics export panel's "Use section" and
 * trimRange use), else the whole video. Pure, so the dialog and the page agree.
 */

/** A section this close to the clip's ends counts as "the whole video". */
export const SECTION_EDGE_EPS = 0.05;

export type TrackScope = 'section' | 'all';

/**
 * The selected section clamped to the video, or null when none is selected or it
 * spans the whole video (nothing to choose between).
 */
export function selectedSection(
  sectionStart: number | null | undefined,
  sectionEnd: number | null | undefined,
  duration: number,
): { start: number; end: number } | null {
  if (sectionStart == null || sectionEnd == null || !(duration > 0)) return null;
  if (!Number.isFinite(sectionStart) || !Number.isFinite(sectionEnd)) return null;
  const start = Math.max(0, sectionStart);
  const end = Math.min(duration, sectionEnd);
  if (!(end > start)) return null;
  if (start <= SECTION_EDGE_EPS && end >= duration - SECTION_EDGE_EPS) return null;
  return { start, end };
}

/** "0:07" for 7 s, "1:05" for 65 s (rounded to whole seconds). */
export function clockLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Labels of the two choices shown when a section is selected. */
export function scopeChoiceLabels(sectionSec: number): { section: string; all: string } {
  return { section: `Selected section (${clockLabel(sectionSec)})`, all: 'Whole video' };
}

/** The scope a run starts with: the section when there is one (no memory between runs). */
export function defaultScope(sectionSec: number | null): TrackScope {
  return sectionSec != null ? 'section' : 'all';
}
