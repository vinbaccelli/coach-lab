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

export type SkeletonExportState = 'ready' | 'analyze' | 'busy' | 'failed';

/** Shown when the export's own analysis fails its self-check (checkAnalyzedTrack). */
export const ANALYSIS_FAILED_TEXT = 'Skeleton could not be analyzed on this video';

/**
 * The skeleton switch's state and status line. It is never a dead switch: the
 * skeleton can always be included (the coach's on-screen Skeleton switch does
 * not gate the export). An untracked part of the range is analyzed first, with
 * the existing AI Track pass, when the coach exports — said here before Export.
 * Only an AI Track already running from the toolbar makes it wait.
 */
export function skeletonExportStatus(trackRunning: boolean, fraction: number, analysisFailed = false): { state: SkeletonExportState; text: string } {
  // The export's own analysis failed its self-check (checkAnalyzedTrack): the
  // stored track would export a frozen skeleton, so it is not offered again.
  if (analysisFailed) return { state: 'failed', text: `${ANALYSIS_FAILED_TEXT}.` };
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

type PoseLike = ReadonlyArray<{ x: number; y: number; score?: number }>;

/** Fewer poses per analyzed second than this (the 'fast' pass samples 30) is too sparse to export. */
export const MIN_POSES_PER_SEC = 3;
/** A pose that never moves more than this share of the body's size over the range is frozen. */
export const MIN_MOTION = 0.001;

/**
 * Self-check of the export's own skeleton analysis, before anything is
 * rendered. `kept` is the poses the pass stored for `spanSec` analyzed
 * seconds; `poses` is `getBakedPoseAt` sampled across those seconds. A pass
 * that saw the same picture on every frame stores the same pose every time:
 * exported, that skeleton would stand still while the player moves.
 *
 * motion = the largest mean joint shift (COCO 5–16, both scores ≥ 0.3) of any
 * sampled pose from the first one, as a share of the first pose's box diagonal.
 */
export function checkAnalyzedTrack(
  kept: number,
  spanSec: number,
  poses: ReadonlyArray<PoseLike | null>,
): { ok: boolean; reason: 'sparse' | 'static' | null; posesPerSec: number; motion: number } {
  const posesPerSec = spanSec > 0 ? kept / spanSec : 0;
  const found = poses.filter((p): p is PoseLike => !!p && p.length >= 17);
  const ref = found[0];
  let motion = 0;
  if (ref) {
    const pts = ref.slice(5, 17).filter((k) => (k.score ?? 1) >= 0.3);
    const xs = pts.map((k) => k.x), ys = pts.map((k) => k.y);
    const diag = pts.length >= 2 ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
    if (diag > 0) {
      for (const p of found) {
        let sum = 0, n = 0;
        for (let j = 5; j <= 16; j++) {
          const a = ref[j], b = p[j];
          if ((a.score ?? 1) < 0.3 || (b.score ?? 1) < 0.3) continue;
          sum += Math.hypot(b.x - a.x, b.y - a.y);
          n++;
        }
        if (n >= 3) motion = Math.max(motion, sum / n / diag);
      }
    }
  }
  const reason = kept < 2 || posesPerSec < MIN_POSES_PER_SEC || found.length < 2 ? 'sparse' : motion < MIN_MOTION ? 'static' : null;
  return { ok: reason === null, reason, posesPerSec, motion };
}

/** Times to sample the analyzed intervals at for `checkAnalyzedTrack`: about every `step` s, at most `max`. */
export function analysisSampleTimes(intervals: ReadonlyArray<{ start: number; end: number }>, step = 0.1, max = 300): number[] {
  const total = intervals.reduce((s, r) => s + Math.max(0, r.end - r.start), 0);
  if (!(total > 0)) return [];
  const n = Math.max(2, Math.min(max, Math.ceil(total / step)));
  const out: number[] = [];
  for (const r of intervals) {
    const len = r.end - r.start;
    if (!(len > 0)) continue;
    const k = Math.max(2, Math.round((n * len) / total));
    for (let i = 0; i < k; i++) out.push(r.start + ((i + 0.5) / k) * len);
  }
  return out;
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
