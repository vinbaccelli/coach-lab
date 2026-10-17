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

export type SkeletonExportState = 'off' | 'ready' | 'partial' | 'none';

/** The skeleton toggle's state and status line. */
export function skeletonExportStatus(skeletonOn: boolean, fraction: number): { state: SkeletonExportState; text: string } {
  if (!skeletonOn) return { state: 'off', text: 'Turn on Skeleton to include it.' };
  if (fraction >= 0.999) return { state: 'ready', text: 'Ready.' };
  if (fraction <= 0) return { state: 'none', text: 'No AI Track on this range, so no skeleton in the video.' };
  const pct = Math.min(99, Math.max(1, Math.round(fraction * 100)));
  return { state: 'partial', text: `Skeleton covers ${pct}% of this range.` };
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
