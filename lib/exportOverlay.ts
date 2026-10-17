/**
 * Metrics export overlays: the pure parts (the drawing itself is
 * components/Canvas.tsx drawExportOverlay; the export loop is lib/cropExport.ts).
 *
 * Drawings are stored in the analysis canvas's logical (CSS) pixels, relative to
 * where the video is letterboxed on screen (`videoBoundsRef`: dx, dy, dw, dh).
 * The export draws them onto a canvas that IS the video frame (outW × outH), so
 * the on-screen video box maps onto the whole output: every overlay keeps the
 * position and proportion the coach saw, at any export size.
 */

export type VideoBox = { dx: number; dy: number; dw: number; dh: number };

/** Logical (x, y) → output (x * sx + tx, y * sy + ty). */
export type OverlayTransform = { sx: number; sy: number; tx: number; ty: number };

/** Maps the on-screen video box onto a whole outW × outH frame. Null for a degenerate box. */
export function overlayTransform(box: VideoBox, outW: number, outH: number): OverlayTransform | null {
  if (!(box.dw > 0) || !(box.dh > 0) || !(outW > 0) || !(outH > 0)) return null;
  const sx = outW / box.dw;
  const sy = outH / box.dh;
  return { sx, sy, tx: -box.dx * sx, ty: -box.dy * sy };
}

/** Applies an OverlayTransform to one logical point (used by tests and probes). */
export function mapPoint(t: OverlayTransform, p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * t.sx + t.tx, y: p.y * t.sy + t.ty };
}

/**
 * Fraction (0..1) of [start, end] covered by an AI Track, by sampling
 * `isTracked(t)` (Canvas `getBakedPoseAt(t) !== null`) at the middle of up to
 * `maxSamples` equal steps, about one every 0.1 s.
 */
export function trackedFraction(
  start: number,
  end: number,
  isTracked: (t: number) => boolean,
  maxSamples = 600,
): number {
  const span = end - start;
  if (!(span > 0) || !Number.isFinite(span)) return 0;
  const n = Math.max(1, Math.min(maxSamples, Math.ceil(span / 0.1)));
  let hit = 0;
  for (let i = 0; i < n; i++) {
    if (isTracked(start + ((i + 0.5) / n) * span)) hit++;
  }
  return hit / n;
}

export type SkeletonExportState = 'ready' | 'analyze' | 'busy';

/**
 * The skeleton switch's state and status line. It is never a dead switch: the
 * skeleton can always be included (the coach's on-screen Skeleton switch does
 * not gate the export). An untracked part of the range is analyzed first, with
 * the existing AI Track pass, when the coach exports — said here before Export.
 * Only an AI Track already running from the toolbar makes it wait.
 */
export function skeletonExportStatus(trackRunning: boolean, fraction: number): { state: SkeletonExportState; text: string } {
  if (trackRunning) return { state: 'busy', text: 'AI Track is running. Wait for it to finish, then export.' };
  if (fraction >= 0.999) return { state: 'ready', text: 'Skeleton ready.' };
  if (fraction <= 0) return { state: 'analyze', text: 'Not analyzed yet. The skeleton will be analyzed first when you export, which adds time.' };
  const pct = Math.min(99, Math.max(1, Math.round(fraction * 100)));
  return { state: 'analyze', text: `Skeleton covers ${pct}% of this range. The rest will be analyzed first when you export, which adds time.` };
}

/**
 * The parts of [start, end] with no AI Track, to analyze before the export.
 * `isTracked` is Canvas `getBakedPoseAt(t) !== null`, which already reaches
 * 0.1 s past each tracked section. Each interval is pulled in by `inset` so the
 * existing pass (finishBakeCapture) does not replace the coach's neighbouring
 * tracks — it drops any track within 0.05 s of the new range. The 0.1 s
 * look-up reach bridges the inset. Intervals shorter than `minLen` are skipped.
 */
export function untrackedIntervals(
  start: number,
  end: number,
  isTracked: (t: number) => boolean,
  step = 0.05,
  minLen = 0.2,
  inset = 0.05,
): Array<{ start: number; end: number }> {
  if (!(end > start) || !Number.isFinite(end - start)) return [];
  const raw: Array<{ start: number; end: number }> = [];
  let openAt: number | null = null;
  const n = Math.ceil((end - start) / step);
  for (let i = 0; i <= n; i++) {
    const t = Math.min(end, start + i * step);
    const tracked = isTracked(t);
    if (!tracked && openAt === null) openAt = t;
    if (tracked && openAt !== null) { raw.push({ start: openAt, end: t }); openAt = null; }
  }
  if (openAt !== null) raw.push({ start: openAt, end });
  return raw
    .map((r) => ({ start: r.start + inset, end: r.end - inset }))
    .filter((r) => r.end - r.start >= minLen);
}

/** The pass's own progress line ("AI-tracking… 42% (…)") as 0..1, or null. */
export function parsePassProgress(statusText: string | null | undefined): number | null {
  const m = typeof statusText === 'string' ? statusText.match(/AI-tracking…\s*(\d{1,3})%/) : null;
  return m ? Math.min(1, Number(m[1]) / 100) : null;
}

/** Overall analysis progress across several intervals: seconds done / seconds total. */
export function analysisProgress(intervals: Array<{ start: number; end: number }>, index: number, current: number): number {
  const total = intervals.reduce((s, r) => s + (r.end - r.start), 0);
  if (!(total > 0)) return 0;
  const done = intervals.slice(0, index).reduce((s, r) => s + (r.end - r.start), 0);
  const cur = intervals[index] ? (intervals[index].end - intervals[index].start) * Math.max(0, Math.min(1, current)) : 0;
  return Math.max(0, Math.min(1, (done + cur) / total));
}

export type DrawingsExportState = 'ready' | 'none' | 'snapshot';

/** The drawings toggle's state and status line. Snapshot-mode drawings are never exported. */
export function drawingsExportStatus(snapshotMode: boolean, drawingCount: number): { state: DrawingsExportState; text: string } {
  if (snapshotMode) return { state: 'snapshot', text: 'Snapshot drawings aren’t exported. Use Snapshot report.' };
  if (drawingCount <= 0) return { state: 'none', text: 'No drawings on the video' };
  return { state: 'ready', text: `${drawingCount} drawing${drawingCount === 1 ? '' : 's'} on the video.` };
}

/** "Includes: video + skeleton + drawings" for the quality panel. */
export function includesLabel(skeleton: boolean, drawings: boolean): string {
  return ['Includes: video', skeleton ? 'skeleton' : null, drawings ? 'drawings' : null].filter(Boolean).join(' + ');
}
