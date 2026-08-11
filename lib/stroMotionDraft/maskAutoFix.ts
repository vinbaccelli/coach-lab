'use client';

/**
 * SKELETON-GUIDED AUTO-CORRECTION — interior hole fill ONLY.
 *
 * This is the one fix from the proposed set that survived a reliability review.
 * The head-size fixes are deliberately NOT here; see "WHAT IS NOT IN THIS FILE".
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 * The segmenter sometimes drops a patch out of the MIDDLE of the athlete — a
 * dark fold of shorts, a shadowed shirt panel, the strip between two legs that
 * are close together. The coach fixes it by hand with the Add brush. This finds
 * those patches and fills them.
 *
 * ── WHY THE TRIGGER IS TRUSTWORTHY: THE OPEN/ENCLOSED DISTINCTION ──────────
 * The decisive property is topological, not anatomical, and it does the hard part
 * of the job before the skeleton is consulted at all.
 *
 * A hole is only a candidate if it is FULLY ENCLOSED by mask — i.e. it cannot be
 * reached by flooding the background inward from the frame border. That single
 * test already excludes the case everyone worries about:
 *
 *   - Legs apart in a stride: the space between them is OPEN at the bottom, so it
 *     connects to the background and is NOT a hole. Never filled.
 *   - Arm raised away from the body: that gap is open too. Never filled.
 *   - A raised arm's gap that a leg happens to close off is bounded by the size
 *     and zone tests below.
 *
 * So the failure mode is not "fills the gap between the legs" — that gap is not
 * enclosed and is invisible to this pass. What IS enclosed is a genuine dropout
 * inside the silhouette, which is exactly what should be filled.
 *
 * ── THE ONE REAL FALSE POSITIVE, AND THE GUARD FOR IT ──────────────────────
 * A hand on the hip makes a real see-through triangle between forearm, flank and
 * upper arm, and that triangle IS topologically enclosed. Filling it grabs
 * background. Three guards, all of which must pass:
 *
 *   1. FULLY INSIDE THE SKELETON ZONE. The zone is capsules around the bones plus
 *      the torso slab — it is the shape the athlete's BODY occupies. The
 *      arm-akimbo triangle is the space BETWEEN limbs, so it falls outside the
 *      capsules and is rejected. This is the load-bearing guard, and it reuses the
 *      existing zone rather than inventing a second idea of "where the body is".
 *   2. SIZE CAP relative to the athlete's own scale. A real see-through region is
 *      large; a dropout patch is small. Capped as a fraction of `unit²`.
 *   3. HIGH-CONFIDENCE POSE ONLY. No zone (weak pose) ⇒ no fill, ever.
 *
 * ── WHY IT IS SAFE EVEN WHEN IT IS WRONG ───────────────────────────────────
 * The op is STRICTLY ADDITIVE and bounded by the zone, so its worst case is
 * "kept a small patch of background that was already inside the athlete's own
 * silhouette" — a brush stroke to undo. It can never cut the player, which is the
 * failure class this codebase treats as unacceptable. That asymmetry is why this
 * fix is built and the trimming one is not.
 *
 * ── WHAT IS NOT IN THIS FILE, AND WHY ──────────────────────────────────────
 * HEAD TOO BIG → TRIM was assessed and REJECTED. It is subtractive, and its
 * trigger would be the head-oval size — the single noisiest number in the zone.
 * skeletonMaskFilter's own history is a chain of fixes for exactly that estimate
 * being wrong: `MIN_SHOULDER_LINE_PX`, the separate `poseHeadScaleUnit` with its
 * `HEAD_UNIT_MAX_INFLATION` ceiling, and the batch-unit floor added after a
 * measured frame where "the head fell outside the zone". Driving an automatic
 * CUT from that estimate would re-open a defect class the file has already paid
 * to close, and the failure is the unacceptable kind (a cut head).
 *
 * HEAD TOO SMALL → RE-SEGMENT is additive and therefore not dangerous, but it
 * shares the same noisy trigger and costs a SAM encode per frame. Deferred until
 * the hole fill has proven the general approach on real footage.
 */

import { buildSkeletonShapeRegion, type SkeletonShapeOptions } from '@/lib/stroMotionDraft/skeletonMaskFilter';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/** Alpha at or below this is "not the athlete" for topology purposes. */
const SOLID_ALPHA = 127;

/**
 * Largest hole that may be filled, as a multiple of `unit²` (unit = shoulder
 * width in px). A segmenter dropout is a patch; a real see-through region is a
 * large part of the silhouette's area. At unit=46px this admits holes up to
 * ~1600px², roughly a 40×40 patch.
 */
const MAX_HOLE_AREA_UNITS2 = 0.75;

/** Below this a "hole" is anti-aliasing noise; filling it changes nothing visible. */
const MIN_HOLE_AREA_PX = 3;

/**
 * Pathology guard. A frame with hundreds of enclosed holes is a segmenter that
 * produced lace, not a frame with a few dropouts — a case worth SEEING rather
 * than silently papering over, so the pass declines and says so.
 */
const MAX_HOLES_PER_FRAME = 64;

export interface HoleFillResult {
  mask: AlphaMask;
  /** False when nothing was changed (and `mask` is the input, unchanged). */
  applied: boolean;
  holesFound: number;
  holesFilled: number;
  filledPx: number;
  rejectedTooBig: number;
  rejectedOutsideZone: number;
  skipReason?: string;
}

/**
 * PURE TOPOLOGY — find every fully-enclosed background component.
 *
 * Exported separately from the skeleton-gated wrapper so the enclosed/open
 * distinction can be reasoned about (and exercised) without a pose in hand. It
 * knows nothing about athletes: it flood-fills the background inward from the
 * frame border, and whatever background it could not reach is enclosed.
 *
 * Returns one index array per enclosed component, largest-first is NOT
 * guaranteed — the caller filters by its own rules.
 */
export function findEnclosedHoles(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxComponentPx: number,
): { holes: number[][]; oversized: number } {
  const n = width * height;
  const solid = (i: number) => data[i] > SOLID_ALPHA;
  /** 1 = background reachable from the frame border, i.e. NOT enclosed. */
  const outside = new Uint8Array(n);
  const stack: number[] = [];

  const seed = (i: number) => {
    if (!solid(i) && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const px = p % width;
    const py = (p / width) | 0;
    if (px > 0) seed(p - 1);
    if (px < width - 1) seed(p + 1);
    if (py > 0) seed(p - width);
    if (py < height - 1) seed(p + width);
  }

  // Whatever background the border flood could not reach is enclosed.
  const seen = new Uint8Array(n);
  const holes: number[][] = [];
  let oversized = 0;
  for (let i = 0; i < n; i++) {
    if (solid(i) || outside[i] || seen[i]) continue;
    const comp: number[] = [];
    let over = false;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop() as number;
      // Keep flooding past the cap so the component is fully marked (otherwise
      // its tail would be rediscovered as a second, smaller hole), but stop
      // recording it.
      if (comp.length <= maxComponentPx) comp.push(p);
      else over = true;
      const px = p % width;
      const py = (p / width) | 0;
      const push = (q: number) => {
        if (!solid(q) && !outside[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      };
      if (px > 0) push(p - 1);
      if (px < width - 1) push(p + 1);
      if (py > 0) push(p - width);
      if (py < height - 1) push(p + width);
    }
    if (over) oversized++;
    else holes.push(comp);
  }
  return { holes, oversized };
}

/**
 * Fill segmenter dropouts inside the athlete, gated by the skeleton zone.
 *
 * Returns the input mask untouched (`applied: false`) on every uncertain path —
 * no pose, no zone, a pathological hole count. Biased toward doing nothing.
 */
export function fillSkeletonInteriorHoles(
  mask: AlphaMask,
  keypoints: Array<{ x: number; y: number; score: number; name?: string }> | null | undefined,
  vw: number,
  vh: number,
  /**
   * The caller's skeleton-shape settings, forwarded VERBATIM so the containment
   * zone tested here is the same one the mask was ANDed with — a zone built from
   * different settings would reject holes the pipeline considers inside the body.
   */
  opts: SkeletonShapeOptions = {},
): HoleFillResult {
  const nothing = (skipReason: string): HoleFillResult => ({
    mask, applied: false, holesFound: 0, holesFilled: 0, filledPx: 0,
    rejectedTooBig: 0, rejectedOutsideZone: 0, skipReason,
  });

  if (!keypoints || keypoints.length < 17) return nothing('no pose');
  if (mask.width !== vw || mask.height !== vh) return nothing('mask/frame size mismatch');

  // The SAME zone the strict AND is built from — one idea of "where the body is",
  // not a second one invented here.
  const built = buildSkeletonShapeRegion(keypoints, vw, vh, opts);
  if (!built) return nothing('no zone (pose too weak)');

  const unit = built.shapes.unitPx;
  if (!(unit >= 1)) return nothing('no usable body scale');
  const maxHolePx = Math.max(MIN_HOLE_AREA_PX, Math.round(MAX_HOLE_AREA_UNITS2 * unit * unit));

  const { holes, oversized } = findEnclosedHoles(mask.data, vw, vh, maxHolePx);
  const holesFound = holes.length + oversized;
  if (!holesFound) return nothing('no enclosed holes');
  if (holesFound > MAX_HOLES_PER_FRAME) {
    return nothing(`${holesFound} enclosed holes — segmenter produced lace, declining`);
  }

  const region = built.region;
  const out: AlphaMask = { width: mask.width, height: mask.height, data: new Uint8ClampedArray(mask.data) };
  let holesFilled = 0;
  let filledPx = 0;
  let rejectedOutsideZone = 0;

  for (const comp of holes) {
    if (comp.length < MIN_HOLE_AREA_PX) continue;
    // EVERY pixel must be inside the zone. Strict on purpose: a hole that pokes
    // outside the body shape is the arm-akimbo triangle, not a dropout.
    let allInZone = true;
    for (let k = 0; k < comp.length; k++) {
      if (!region[comp[k]]) { allInZone = false; break; }
    }
    if (!allInZone) { rejectedOutsideZone++; continue; }
    for (let k = 0; k < comp.length; k++) out.data[comp[k]] = 255;
    holesFilled++;
    filledPx += comp.length;
  }

  console.log(
    `[autoFixHoles] unit=${unit.toFixed(0)}px maxHole=${maxHolePx}px² — ` +
    `${holesFound} enclosed hole(s): filled ${holesFilled} (${filledPx}px), ` +
    `rejected ${oversized} too-big / ${rejectedOutsideZone} outside-zone`,
  );

  if (!holesFilled) {
    return {
      mask, applied: false, holesFound, holesFilled: 0, filledPx: 0,
      rejectedTooBig: oversized, rejectedOutsideZone, skipReason: 'every hole rejected',
    };
  }
  return {
    mask: out, applied: true, holesFound, holesFilled, filledPx,
    rejectedTooBig: oversized, rejectedOutsideZone,
  };
}
