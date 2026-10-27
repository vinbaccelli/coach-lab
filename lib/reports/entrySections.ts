/**
 * The decoder's structured sections, as stored on the entry so the in-app report
 * can show the full report. Whitelisted fields only (the Docs-only image sizing
 * is dropped) and size-capped. Best-effort by construction: any problem here
 * returns the metadata unchanged — it must never fail the save.
 */
export function withSections(
  metadata: Record<string, unknown>,
  sections: Array<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  try {
    if (!Array.isArray(sections) || sections.length === 0) return metadata;
    const kept = sections.map((s) => ({
      ...(typeof s.heading === 'string' ? { heading: s.heading } : {}),
      ...(s.headingLevel === 'h2' || s.headingLevel === 'h3' ? { headingLevel: s.headingLevel } : {}),
      ...(Array.isArray(s.lines) ? { lines: s.lines.filter((l) => typeof l === 'string') } : {}),
      ...(typeof s.notes === 'string' ? { notes: s.notes } : {}),
      ...(typeof s.imageUrl === 'string' ? { imageUrl: s.imageUrl } : {}),
    }));
    if (JSON.stringify(kept).length > 400_000) return metadata;
    return { ...metadata, sections: kept };
  } catch {
    return metadata;
  }
}
