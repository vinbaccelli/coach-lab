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

export type SkeletonExportState = 'ready' | 'analyze' | 'busy' | 'failed' | 'stopping';

/** Shown when the export's own analysis fails its self-check (checkAnalyzedTrack). */
export const ANALYSIS_FAILED_TEXT = 'Skeleton could not be analyzed on this video';

/**
 * The skeleton switch's state and status line. It is never a dead switch: the
 * skeleton can always be included (the coach's on-screen Skeleton switch does
 * not gate the export). An untracked part of the range is analyzed first, with
 * the existing AI Track pass, when the coach exports — said here before Export.
 * Only an AI Track already running from the toolbar makes it wait.
 */
export function skeletonExportStatus(
  trackRunning: boolean,
  fraction: number,
  analysisFailed = false,
  stopping = false,
): { state: SkeletonExportState; text: string } {
  // The export's own pass, cancelled, still finishing the frame it is on (it
  // checks the abort between frames): it is ours, not "an AI Track running"
  // (KNOWN_ISSUES 054). Export waits until it has settled.
  if (stopping) return { state: 'stopping', text: 'Stopping the analysis…' };
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
 * After the export's own analysis failed or was cancelled: what to do with the
 * track it may have left (a cancelled pass keeps the parts it finished; a
 * failed one keeps the bad track). With no track before the analysis, all
 * tracks are the analysis's own, so clearing all of them is exact. With an
 * earlier AI Track, Canvas can only clear every track, so nothing is removed.
 */
export function analysisCleanup(hadTrackBefore: boolean): { clear: boolean; note: string } {
  return hadTrackBefore
    ? { clear: false, note: 'Your earlier AI Track was left as it is (AI Track can only be cleared as a whole, from the Skeleton menu).' }
    : { clear: true, note: 'The unfinished skeleton analysis was removed.' };
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
/** A step smaller than this share of the body's size is the same pose read again (a repeated picture). */
export const REPEAT_EPS = 1e-4;
/** Repeated steps on more than this share of the range: frozen, with a jump now and then. */
export const MAX_REPEAT_SHARE = 0.6;

/** Box diagonal of joints 5–16 (score ≥ 0.3), or 0. */
function bodyDiag(p: PoseLike): number {
  const pts = p.slice(5, 17).filter((k) => (k.score ?? 1) >= 0.3);
  if (pts.length < 2) return 0;
  const xs = pts.map((k) => k.x), ys = pts.map((k) => k.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * Mean shift of joints 5–16 (both scores ≥ 0.3) from `a` to `b`, as a share of
 * `a`'s body size. Null when fewer than 3 joints compare or `a` has no size.
 */
export function poseShift(a: PoseLike | null | undefined, b: PoseLike | null | undefined): number | null {
  if (!a || !b || a.length < 17 || b.length < 17) return null;
  const diag = bodyDiag(a);
  if (!(diag > 0)) return null;
  let sum = 0, n = 0;
  for (let j = 5; j <= 16; j++) {
    if ((a[j].score ?? 1) < 0.3 || (b[j].score ?? 1) < 0.3) continue;
    sum += Math.hypot(b[j].x - a[j].x, b[j].y - a[j].y);
    n++;
  }
  return n >= 3 ? sum / n / diag : null;
}

export type AnalyzedTrackCheck = {
  ok: boolean;
  reason: 'sparse' | 'static' | 'repeated' | null;
  posesPerSec: number;
  /** Largest shift of any sampled pose from the first one (share of body size). */
  motion: number;
  /** Share of consecutive sampled steps where the pose did not change at all. */
  repeatShare: number;
};

/**
 * Self-check of the export's own skeleton analysis, before anything is
 * rendered. `kept` is the poses the pass stored for `spanSec` analyzed
 * seconds; `poses` is `getBakedPoseAt` sampled across those seconds about once
 * per pass frame (`analysisSampleTimes(intervals, 1 / 30)`).
 *
 * - sparse: too few poses for the time analyzed;
 * - static: the pose never moves (the pass read the same picture every time);
 * - repeated: the pose is unchanged from one frame to the next on most of the
 *   range and jumps in between (the pass got a fresh picture only now and then).
 *   A real detection never repeats exactly: even a still player jitters.
 * Detector noise on a stale picture passes here; the render's own check
 * (`skeletonFollowsVideo`) compares the skeleton with the video frames.
 */
export function checkAnalyzedTrack(kept: number, spanSec: number, poses: ReadonlyArray<PoseLike | null>): AnalyzedTrackCheck {
  const posesPerSec = spanSec > 0 ? kept / spanSec : 0;
  const found = poses.filter((p): p is PoseLike => !!p && p.length >= 17);
  let motion = 0;
  for (const p of found) motion = Math.max(motion, poseShift(found[0], p) ?? 0);
  let steps = 0, repeats = 0;
  for (let i = 1; i < found.length; i++) {
    const d = poseShift(found[i - 1], found[i]);
    if (d === null) continue;
    steps++;
    if (d < REPEAT_EPS) repeats++;
  }
  const repeatShare = steps ? repeats / steps : 0;
  const reason = kept < 2 || posesPerSec < MIN_POSES_PER_SEC || found.length < 2 ? 'sparse'
    : motion < MIN_MOTION ? 'static'
      : repeatShare > MAX_REPEAT_SHARE ? 'repeated' : null;
  return { ok: reason === null, reason, posesPerSec, motion, repeatShare };
}

// ── Render-time check: does the skeleton follow the video? ──────────────────
//
// The pre-render check only sees the stored poses. A pass that read a stale
// picture with detector noise stores poses that change a little and never follow
// the player. The render draws the real frames (those are the frames in the
// file), so it can compare: around the skeleton, did the picture change, and
// did the skeleton move with it?

/** Every this many seconds of media time, one comparison step. */
export const FOLLOW_STEP_SEC = 0.25;
/** Mean |Δ grey| (0–255) of the region thumbnail above which the picture moved. */
export const IMAGE_MOVED = 6;
/**
 * The skeleton moved with the picture when its joints shifted by at least this
 * share of its size. Measured per 0.25 s step: real tracks of a moving player
 * 0.98–2.6% (test clips), a stale picture with detector noise 0.09–0.14%.
 */
export const POSE_FOLLOWS = 0.004;
/** Steps where the picture moved but the skeleton did not, above this share: frozen. */
export const MAX_STILL_SHARE = 0.7;

/**
 * The output-pixel region to watch around a pose: its joint box grown by half
 * its size on every side, clamped to the frame. `sx`/`sy` map video px → output px.
 */
export function poseRegion(kps: PoseLike | null, sx: number, sy: number, outW: number, outH: number): { x: number; y: number; w: number; h: number } | null {
  if (!kps || kps.length < 17) return null;
  const pts = kps.slice(5, 17).filter((k) => (k.score ?? 1) >= 0.3);
  if (pts.length < 3) return null;
  const xs = pts.map((k) => k.x * sx), ys = pts.map((k) => k.y * sy);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const gx = Math.max(8, (x1 - x0) / 2), gy = Math.max(8, (y1 - y0) / 2);
  const x = Math.max(0, Math.floor(x0 - gx)), y = Math.max(0, Math.floor(y0 - gy));
  const w = Math.min(outW, Math.ceil(x1 + gx)) - x, h = Math.min(outH, Math.ceil(y1 + gy)) - y;
  return w >= 4 && h >= 4 ? { x, y, w, h } : null;
}

/** RGBA pixels → grey (0–255) per pixel. */
export function toGrey(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return out;
}

/** Mean absolute difference of two equally sized grey thumbnails. */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

export type FollowStep = { image: number; pose: number };

/**
 * Verdict over the steps so far. `moved` steps are those where the picture
 * around the skeleton changed; `still` are those of them where the skeleton did
 * not move with it. Frozen (`ok: false`) when at least `minMoved` steps moved
 * and most of them left the skeleton still; `ok: null` while there is too
 * little evidence either way.
 */
export function skeletonFollowsVideo(steps: ReadonlyArray<FollowStep>, minMoved = 4): { ok: boolean | null; moved: number; still: number } {
  let moved = 0, still = 0;
  for (const s of steps) {
    if (s.image < IMAGE_MOVED) continue;
    moved++;
    if (s.pose < POSE_FOLLOWS) still++;
  }
  if (moved < minMoved) return { ok: null, moved, still };
  return { ok: still / moved <= MAX_STILL_SHARE, moved, still };
}

/** The failure line with the numbers that say what happened (readable off a phone screenshot). */
export function analysisFailedText(
  pre: AnalyzedTrackCheck | null,
  kept: number,
  spanSec: number,
  follow: { moved: number; still: number } | null,
): string {
  const parts: string[] = [];
  if (pre) {
    parts.push(`${kept} pose${kept === 1 ? '' : 's'} in ${spanSec.toFixed(1)} s (${pre.posesPerSec.toFixed(1)}/s)`);
    parts.push(`motion ${(pre.motion * 100).toFixed(1)}%`);
    parts.push(`repeated ${Math.round(pre.repeatShare * 100)}%`);
  }
  if (follow) parts.push(`video moved ${follow.moved}×, skeleton still ${follow.still}×`);
  return `${ANALYSIS_FAILED_TEXT} (${parts.join(' · ')}).`;
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

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where to dock the compact analysis bar so the analysis video stays fully in
 * view while the pass seeks it (iOS Safari may not hand the pose detector a
 * fresh frame of a covered video). Tries, in order: below the video's picture,
 * above it, to its right, to its left. When nothing fits (a picture that fills
 * the screen) it takes the bottom edge, and `overlap` says how many px² of the
 * picture it covers.
 */
export function dockAnalysisBar(
  view: { w: number; h: number },
  video: Rect | null,
  barH: number,
  { margin = 8, maxW = 560, minSideW = 240 }: { margin?: number; maxW?: number; minSideW?: number } = {},
): { left: number; top: number; width: number; side: 'below' | 'above' | 'right' | 'left' | 'edge'; overlap: number } {
  const fullW = Math.max(0, Math.min(maxW, view.w - 2 * margin));
  const centreX = (w: number) => Math.round((view.w - w) / 2);
  const edge = { left: centreX(fullW), top: Math.max(margin, view.h - margin - barH), width: fullW };
  if (!video || !(video.w > 0) || !(video.h > 0)) return { ...edge, side: 'edge', overlap: 0 };
  const vx0 = Math.max(0, video.x), vy0 = Math.max(0, video.y);
  const vx1 = Math.min(view.w, video.x + video.w), vy1 = Math.min(view.h, video.y + video.h);
  if (view.h - vy1 >= barH + 2 * margin) {
    return { left: centreX(fullW), top: Math.round(Math.min(view.h - margin - barH, vy1 + margin)), width: fullW, side: 'below', overlap: 0 };
  }
  if (vy0 >= barH + 2 * margin) {
    return { left: centreX(fullW), top: Math.round(Math.max(margin, vy0 - margin - barH)), width: fullW, side: 'above', overlap: 0 };
  }
  const sideTop = Math.round(Math.max(margin, Math.min(view.h - margin - barH, (vy0 + vy1) / 2 - barH / 2)));
  const rightW = view.w - vx1 - 2 * margin;
  if (rightW >= minSideW) return { left: Math.round(vx1 + margin), top: sideTop, width: Math.min(maxW, Math.floor(rightW)), side: 'right', overlap: 0 };
  const leftW = vx0 - 2 * margin;
  if (leftW >= minSideW) {
    const width = Math.min(maxW, Math.floor(leftW));
    return { left: Math.round(vx0 - margin - width), top: sideTop, width, side: 'left', overlap: 0 };
  }
  const ox = Math.max(0, Math.min(edge.left + edge.width, vx1) - Math.max(edge.left, vx0));
  const oy = Math.max(0, Math.min(edge.top + barH, vy1) - Math.max(edge.top, vy0));
  return { ...edge, side: 'edge', overlap: Math.round(ox * oy) };
}

export type DrawingsExportState = 'ready' | 'none';

/**
 * The drawings switch's state and status line. "Drawings" are the drawings on
 * screen now — the live ones, or in SNAPSHOT mode the selected snapshot's (the
 * canvas holds exactly those) — drawn on EVERY frame outside snapshot holds.
 * A hold shows only its own snapshot's drawings (Snapshots switch). Never a dead
 * switch: it is off only when there is nothing to draw, and says so.
 */
export function drawingsExportStatus(snapshotMode: boolean, drawingCount: number, holdsOn = false): { state: DrawingsExportState; text: string } {
  if (drawingCount <= 0) {
    return {
      state: 'none',
      text: snapshotMode
        ? 'No drawings on this snapshot. Draw on it to include them.'
        : 'No drawings on the video. Draw on the video to include them.',
    };
  }
  const n = `${drawingCount} drawing${drawingCount === 1 ? '' : 's'}`;
  const where = holdsOn ? 'on every frame except snapshot holds' : 'on every frame';
  return {
    state: 'ready',
    text: snapshotMode ? `This snapshot's ${n}, shown ${where}.` : `${n} on the video, shown ${where}.`,
  };
}

/** Drawings switch default: on in LIVE mode; off in SNAPSHOT mode (its drawings already show in its hold). */
export function drawingsDefaultOn(snapshotMode: boolean): boolean {
  return !snapshotMode;
}

/** The page is pinch-zoomed (visualViewport.scale), beyond rounding. */
export function pageZoomed(scale: number | null | undefined): boolean {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 1.02;
}

/**
 * Why the export's skeleton analysis must not start now, or null. A zoomed page
 * can leave the analysis video covered or off screen, and iOS then hands the
 * detector the same stale frame: a frozen skeleton (KNOWN_ISSUES 052).
 */
export function analysisBlockedReason(pageScale: number | null | undefined): string | null {
  if (!pageZoomed(pageScale)) return null;
  return `The page is zoomed in (${Math.round((pageScale as number) * 100)}%). Pinch out to 100% first: a zoomed page can hide the video while its skeleton is analyzed, which freezes the skeleton.`;
}

/** "Includes: video + skeleton + drawings" for the quality panel. */
export function includesLabel(skeleton: boolean, drawings: boolean): string {
  return ['Includes: video', skeleton ? 'skeleton' : null, drawings ? 'drawings' : null].filter(Boolean).join(' + ');
}

// ── Snapshot holds ──────────────────────────────────────────────────────────
//
// With Snapshots on, each snapshot inside the trimmed range becomes a HOLD in
// the exported video: the video plays, freezes on the snapshot's frame for
// `seconds` with that snapshot's drawings and frozen pose, then continues
// (lib/cropExport.ts `holds`, Canvas drawExportOverlay `hold`).

/** Hold length setting (seconds): range, step and default. */
export const HOLD_MIN_SEC = 0.5;
export const HOLD_MAX_SEC = 5;
export const HOLD_STEP_SEC = 0.5;
export const HOLD_DEFAULT_SEC = 2;
/** One video frame at 30 fps: a snapshot at the out-point is held this much before it. */
export const HOLD_FRAME_SEC = 1 / 30;

/** A hold length clamped to the setting's range and step. */
export function clampHoldSec(sec: number): number {
  if (!Number.isFinite(sec)) return HOLD_DEFAULT_SEC;
  const stepped = Math.round(sec / HOLD_STEP_SEC) * HOLD_STEP_SEC;
  return Math.min(HOLD_MAX_SEC, Math.max(HOLD_MIN_SEC, stepped));
}

export type HoldPlan = {
  /** One per snapshot in the range, in time order: `at` = source seconds to freeze on. */
  holds: Array<{ at: number; seconds: number; id: string }>;
  inRange: number;
  total: number;
  totalHoldSec: number;
};

/**
 * Which snapshots become holds for the range [start, end], and where.
 * - In range: start ≤ timeSec ≤ end (1 ms tolerance). Outside: no hold.
 * - Very start: held at `start` (before playback begins).
 * - Very end: clamped to one frame before `end` (the render stops AT `end`,
 *   so a hold there would never be reached).
 * - Close or identical times are NOT merged: every snapshot keeps its own hold
 *   with its own drawings; two on the same frame are held one after the other
 *   on the same picture. Ties keep the snapshots' order.
 */
export function holdSchedule(
  snapshots: ReadonlyArray<{ id: string; timeSec: number }>,
  start: number,
  end: number,
  holdSec: number,
): HoldPlan {
  const eps = 1e-3;
  const seconds = clampHoldSec(holdSec);
  const valid = snapshots.filter((s) => Number.isFinite(s.timeSec));
  if (!(end > start)) return { holds: [], inRange: 0, total: valid.length, totalHoldSec: 0 };
  const last = Math.max(start, end - HOLD_FRAME_SEC);
  const holds = valid
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.timeSec >= start - eps && s.timeSec <= end + eps)
    .sort((a, b) => a.s.timeSec - b.s.timeSec || a.i - b.i)
    .map(({ s }) => ({ at: Math.min(last, Math.max(start, s.timeSec)), seconds, id: s.id }));
  return { holds, inRange: holds.length, total: valid.length, totalHoldSec: holds.length * seconds };
}

/** "2 s", "1.5 s" */
export function formatHoldSec(sec: number): string {
  const r = Math.round(sec * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)} s`;
}

export type SnapshotsExportState = 'ready' | 'none' | 'outside';

/** The Snapshots switch's state and status line. */
export function snapshotsExportStatus(plan: HoldPlan, on: boolean): { state: SnapshotsExportState; text: string } {
  if (plan.total <= 0) return { state: 'none', text: 'No snapshots yet. Create one (Create Snapshot or AI Detect) to hold on it in the video.' };
  const of = `${plan.inRange} of ${plan.total} snapshot${plan.total === 1 ? '' : 's'}`;
  if (plan.inRange <= 0) return { state: 'outside', text: `None of your ${plan.total} snapshot${plan.total === 1 ? ' is' : 's are'} in this range. Move the trim to include one.` };
  const verb = plan.inRange === 1 ? 'is' : 'are';
  return {
    state: 'ready',
    text: on
      ? `${of} ${verb} in this range · +${formatHoldSec(plan.totalHoldSec)} of holds`
      : `${of} ${verb} in this range. Turn on to hold on each with its drawings and pose.`,
  };
}

/** The Snapshots switch's own line (the range line under the trim bar is `snapshotsExportStatus`). */
export function snapshotsSwitchText(state: SnapshotsExportState, on: boolean, holdSec: number): string {
  if (state === 'none') return 'No snapshots yet. Create one (Create Snapshot or AI Detect) to hold on it in the video.';
  if (state === 'outside') return 'No snapshot in this range.';
  return on
    ? `The video freezes ${formatHoldSec(clampHoldSec(holdSec))} on each, with its drawings and pose.`
    : 'Off: the video plays straight through.';
}

/**
 * Render progress (0..1) on the OUTPUT timeline: media seconds rendered plus
 * hold seconds shown, over the range plus all holds. The video stands still
 * during a hold while this keeps moving, so a hold never reads as a stall.
 */
export function outputProgress(mediaDoneSec: number, holdDoneSec: number, spanSec: number, totalHoldSec: number): number {
  const total = Math.max(0, spanSec) + Math.max(0, totalHoldSec);
  if (!(total > 0)) return 0;
  const done = Math.max(0, Math.min(spanSec, mediaDoneSec)) + Math.max(0, Math.min(totalHoldSec, holdDoneSec));
  return Math.max(0, Math.min(1, done / total));
}

/** "Includes: video + skeleton + drawings + 2 snapshot holds" */
export function includesLabelWithHolds(skeleton: boolean, drawings: boolean, holds: number): string {
  const base = includesLabel(skeleton, drawings);
  return holds > 0 ? `${base} + ${holds} snapshot hold${holds === 1 ? '' : 's'}` : base;
}
