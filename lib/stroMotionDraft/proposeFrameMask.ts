'use client';

import { buildMatteAlphaMask } from '@/lib/objectMultiplier';
import { normalizeObjectBox, type StroMotionSubjectBox } from '@/lib/stroMotion';
import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureSource';
import { maskHasContent } from '@/lib/stroMotionDraft/frameMask';
import { cloneAlphaMask, embedRegionMask, fillBoxMask, intersectMaskWithBox, resampleAlphaMask } from "@/lib/stroMotionDraft/maskUtils";
// Flag ONLY — a couple of localStorage reads with no imports of its own. The
// detector and SAM both stay behind dynamic imports that are never reached
// outside the implement modes, so a Player-mode run pays one boolean for this.
import { autoRacketEnabled } from '@/lib/stroMotionDraft/autoRacketFlags';
// Flag ONLY — a localStorage read with no imports of its own, so a default run
// never loads the correction code. Default OFF; see maskAutoFix.ts.
import {
  ARM_RESCUE_TUNING,
  HAT_EXTRA_HEAD_UNITS,
  autoArmRescueEnabled,
  autoFixHolesEnabled,
  autoHatAllowanceEnabled,
} from '@/lib/stroMotionDraft/maskAutoFixFlags';
import type { AlphaMask, StroMotionObjectType } from '@/lib/stroMotionDraft/types';
// TYPE-ONLY: erased at compile time, so this adds no runtime import of the
// trajectory module — which stays behind the same dynamic import as the racket
// candidate, and is never loaded when the feature is off.
import type { RacketAxis as RacketAxisForFrame } from '@/lib/stroMotionDraft/racketTrajectory';

/**
 * Context left around the skeleton zone when cropping for the segmenter, as a
 * fraction of the zone's own size. Enough that the athlete is not flush against
 * the crop edge (which reads as a cut-off subject), small enough that the model's
 * 256px budget still lands almost entirely on them.
 */
const SEGMENT_CROP_PAD = 0.12;

export interface ProposeFrameMaskResult {
  sourceFrame: ImageBitmap;
  aiSnapshot: AlphaMask;
  working: AlphaMask;
}

function boxToPixels(
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
  padFraction = 0.12,
) {
  const px = Math.round(box.x * vw);
  const py = Math.round(box.y * vh);
  const pw = Math.max(1, Math.round(box.width * vw));
  const ph = Math.max(1, Math.round(box.height * vh));
  const padX = Math.round(pw * padFraction);
  const padY = Math.round(ph * padFraction);
  const x0 = Math.max(0, px - padX);
  const y0 = Math.max(0, py - padY);
  const x1 = Math.min(vw, px + pw + padX);
  const y1 = Math.min(vh, py + ph + padY);
  return {
    px: x0,
    py: y0,
    pw: Math.max(1, x1 - x0),
    ph: Math.max(1, y1 - y0),
  };
}

/**
 * Motion-difference matte — the classic Dartfish StroMotion technique.
 *
 * The moving object (racket/bat/club/limb) is exactly what CHANGED between this
 * frame and the BACKGROUND (ideally a temporal-median plate; single reference
 * frame as fallback). Pipeline inside the selection box:
 *   diff → SOFT alpha (smoothstep 30..70 of channel-diff — preserves the
 *   semi-transparency of motion-blurred implements) → strong-core binarize +
 *   morphological open → CONNECTED COMPONENTS keep only blobs near the box
 *   centre (kills background speckle) → alpha gated by the kept support →
 *   3×3 box-blur feather.
 * Requires a reasonably static camera (tripod/phone-mount), our V1 capture
 * case. Returns null when the diff is unreliable (empty or blown-out box).
 */
async function motionDiffMaskInSelection(
  sourceFrame: ImageBitmap,
  background: { bitmap: ImageBitmap; scale: number },
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
): Promise<AlphaMask | null> {
  const { px, py, pw, ph } = boxToPixels(box, vw, vh);
  // Process at a capped resolution — masks don't need full-res precision and
  // the morphology stays fast.
  const scale = Math.min(1, 420 / Math.max(pw, ph));
  const w = Math.max(8, Math.round(pw * scale));
  const h = Math.max(8, Math.round(ph * scale));
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(sourceFrame, px, py, pw, ph, 0, 0, w, h);
  const cur = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  // The background may live at a reduced resolution (median plate) — its
  // source rect is the same box scaled into plate space.
  const bs = background.scale;
  ctx.drawImage(background.bitmap, px * bs, py * bs, pw * bs, ph * bs, 0, 0, w, h);
  const bg = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const T_LOW = 30;   // below: definitely background
  const T_HIGH = 70;  // above: definitely moving object
  const alphaRaw = new Uint8ClampedArray(n);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d =
      Math.abs(cur.data[o] - bg.data[o]) +
      Math.abs(cur.data[o + 1] - bg.data[o + 1]) +
      Math.abs(cur.data[o + 2] - bg.data[o + 2]);
    // smoothstep(T_LOW, T_HIGH, d) → soft alpha keeps motion-blur transparency.
    const tRaw = (d - T_LOW) / (T_HIGH - T_LOW);
    const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw * tRaw * (3 - 2 * tRaw);
    alphaRaw[i] = Math.round(t * 255);
    core[i] = d > T_HIGH ? 1 : 0;
  }

  const morph = (src: Uint8Array, op: 'erode' | 'dilate'): Uint8Array => {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = op === 'erode' ? 1 : 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dxx = -1; dxx <= 1; dxx++) {
            const yy = y + dy, xx = x + dxx;
            const s = yy < 0 || xx < 0 || yy >= h || xx >= w ? 0 : src[yy * w + xx];
            if (op === 'erode') v = Math.min(v, s); else v = Math.max(v, s);
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };

  // Open (erode→dilate) kills pixel speckle in the strong core.
  let m = morph(core, 'erode');
  m = morph(m, 'dilate');

  // Connected components on the cleaned core: keep only blobs whose bounding
  // box touches the inner 60% of the selection — the object the coach framed —
  // and drop peripheral movers (shadows, other players, wind-blown net).
  const labels = new Int32Array(n).fill(-1);
  const innerX0 = w * 0.2, innerX1 = w * 0.8, innerY0 = h * 0.2, innerY1 = h * 0.8;
  const stack: number[] = [];
  let nextLabel = 0;
  const keepLabel: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (!m[i] || labels[i] !== -1) continue;
    const label = nextLabel++;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    stack.push(i);
    labels[i] = label;
    while (stack.length) {
      const p = stack.pop() as number;
      const pxl = p % w, pyl = (p / w) | 0;
      if (pxl < minX) minX = pxl;
      if (pxl > maxX) maxX = pxl;
      if (pyl < minY) minY = pyl;
      if (pyl > maxY) maxY = pyl;
      // 4-connectivity
      if (pxl > 0 && m[p - 1] && labels[p - 1] === -1) { labels[p - 1] = label; stack.push(p - 1); }
      if (pxl < w - 1 && m[p + 1] && labels[p + 1] === -1) { labels[p + 1] = label; stack.push(p + 1); }
      if (pyl > 0 && m[p - w] && labels[p - w] === -1) { labels[p - w] = label; stack.push(p - w); }
      if (pyl < h - 1 && m[p + w] && labels[p + w] === -1) { labels[p + w] = label; stack.push(p + w); }
    }
    keepLabel[label] = maxX >= innerX0 && minX <= innerX1 && maxY >= innerY0 && minY <= innerY1;
  }
  const kept = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (labels[i] >= 0 && keepLabel[labels[i]]) kept[i] = 1;

  // Support = kept core grown twice, so the soft alpha skirt survives around it.
  let support = morph(kept, 'dilate');
  support = morph(support, 'dilate');

  let on = 0;
  for (let i = 0; i < n; i++) on += kept[i];
  const frac = on / n;
  // Nearly-empty diff = object didn't move / wrong reference; nearly-full =
  // camera moved or exposure shifted. Both mean "don't trust this".
  if (frac < 0.004 || frac > 0.9) return null;

  // Gate the soft alpha by the support, then feather with a 3×3 box blur.
  const gated = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) gated[i] = support[i] ? alphaRaw[i] : 0;
  const soft = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dxx = -1; dxx <= 1; dxx++) {
          const yy = y + dy, xx = x + dxx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          acc += gated[yy * w + xx];
          cnt++;
        }
      }
      soft[y * w + x] = Math.round(acc / cnt);
    }
  }

  // Upscale (nearest) back to the crop's native resolution for embedding.
  const up = new Uint8ClampedArray(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / ph));
    for (let x = 0; x < pw; x++) {
      const sx2 = Math.min(w - 1, Math.floor((x * w) / pw));
      up[y * pw + x] = soft[sy * w + sx2];
    }
  }
  return embedRegionMask(vw, vh, px, py, { width: pw, height: ph, data: up });
}

async function matteMaskInSelection(
  sourceFrame: ImageBitmap,
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
): Promise<AlphaMask> {
  const { px, py, pw, ph } = boxToPixels(box, vw, vh);
  const crop = await createImageBitmap(sourceFrame, px, py, pw, ph);
  try {
    const regionMatte = await buildMatteAlphaMask(crop);
    return embedRegionMask(vw, vh, px, py, regionMatte);
  } finally {
    crop.close();
  }
}

/**
 * Background-removal proposal after coach Select Area.
 *
 * Proposal ladder (best → safest):
 *   0. POSE-ANCHORED SEGMENTATION (MediaPipe MagicTouch) — when a scribble over
 *      the athlete + implement is supplied (auto path), cut that subject out
 *      directly. This is the Dartfish-grade path.
 *   1. MOTION DIFF vs the background reference frame — isolates whatever MOVED
 *      inside the box (any sport implement, any color).
 *   2. Border flood-fill matte (color-based) when the diff is unreliable.
 *   3. Solid selection-box fill so the manual editor always opens with something.
 * The coach's manual mask editor remains the final say on every frame.
 */
export async function proposeFrameMask(
  video: HTMLVideoElement,
  timeSec: number,
  selectionBox: StroMotionSubjectBox,
  backgroundTimeSec: number,
  objectType: StroMotionObjectType = 'racket',
  /** Temporal-median plate (preferred diff reference — see backgroundPlate.ts). */
  backgroundPlate?: { bitmap: ImageBitmap; scale: number } | null,
  /** Pose-derived scribble (normalized points over athlete + implement). */
  scribble?: Array<{ x: number; y: number }> | null,
  /**
   * AI auto-detect only. Enables two skeleton-guided behaviours:
   *   1. the frame is CROPPED to the skeleton zone's bounds before the person
   *      segmenter runs, so the model spends its 256px budget on the athlete
   *      rather than the scenery (see rung 0a), and
   *   2. the finished mask is intersected with the thickened-skeleton zone —
   *      a STRICT pixel-wise AND (`filterMaskBySkeletonShape`), which drops
   *      every pixel outside the zone, including detached background blobs.
   * Off by default so the manual Select Area and Re-propose paths keep their
   * exact current behaviour and pay no extra pose cost.
   *
   * NOTE: this used to say the mask was "filtered to components the skeleton
   * reaches". That described an earlier connected-component implementation and
   * had drifted — there is no component analysis in this path; the zone is an
   * index-wise AND. Corrected rather than left to mislead the next reader.
   */
  useSkeletonGuidance = false,
  /**
   * The APP'S EXISTING skeleton for this frame — COCO-17, FULL-FRAME NORMALIZED.
   *
   * Supplied by the caller (page.tsx reads it from the same source the angle and
   * metric features use: baked AI-Track pose → live cache → on-demand detection).
   * This replaces the short-lived separate crop-based detector, which returned 0
   * joints on real footage. Reusing the app's skeleton also means every future
   * improvement to it improves background removal for free, and the coach's LOCK
   * tool already decides WHICH human it follows — so no cropping is needed to
   * disambiguate people.
   */
  skeletonKeypoints?: Array<{ x: number; y: number; score: number; name?: string }> | null,
  /**
   * A frame the caller has ALREADY captured for this same `timeSec`.
   *
   * When supplied, no capture happens here — the mask is built from, and the
   * segmenter runs on, the exact bitmap the caller also used to detect the
   * skeleton. That makes image, skeleton and segmentation one provably identical
   * frame rather than three results of separate seeks that ought to agree.
   *
   * OWNERSHIP IS UNCHANGED: the bitmap comes back as `result.sourceFrame` and the
   * draft closes it, exactly as it does for a frame captured here. A caller that
   * passes one in must therefore hand it over and not close it itself.
   */
  preCapturedFrame?: ImageBitmap | null,
  /**
   * This frame's RACKET TRAJECTORY AXIS, resolved across the whole batch by the
   * Phase-0 pass in `autoProcessFrames` (racketTrajectory.ts).
   *
   * DIAGNOSTIC ONLY, and deliberately so. The axis is handed in purely so the
   * debug overlay can draw it; NOTHING in the mask ladder reads it, and no pixel
   * changes because of it. Masking along the axis is Stage 3, which is only worth
   * building once the axis has been seen to land on the real racket — if it does
   * not, nothing was painted and nothing was lost.
   *
   * Per-frame rather than a whole trajectory because the caller already resolved
   * which frame is which; passing the batch here would make this function
   * responsible for a lookup it has no business owning.
   */
  racketAxis?: RacketAxisForFrame | null,
  /**
   * Batch body-scale reference as `unit / width` (`batchScaleUnitNorm`).
   *
   * Same shape as `racketAxis` above, and for the same reason: a value only the
   * whole batch can resolve, computed once in `autoProcessFrames` and handed in
   * per frame. `poseScaleUnit`'s own collapse defence is intra-frame, so it
   * cannot catch a pose that degrades as a whole — every internal cross-check
   * agrees and a 12px shoulder width passes through on a frame where the athlete
   * is normal-sized. Only the other frames know that did not happen.
   *
   * Feeds the zone, the bone core AND the segmenter crop, since all three scale
   * from `unit`. Null/omitted ⇒ per-frame behaviour, so the manual Select Area
   * and Re-propose paths are byte-for-byte unchanged.
   */
  unitFloorNorm?: number | null,
  /**
   * SAM embedding-cache key for this frame — `racketFrameKey(frameIndex, timeSec)`.
   *
   * Required by AUTO-RACKET and used for nothing else; omit it and that rung
   * cannot run, whatever the mode says. Handed in rather than built here because
   * this function is given a `timeSec` but never a frame INDEX, and the key must
   * be byte-identical to the one the racket CLICK tool uses or the two would
   * encode the same frame twice into a 420MB budget instead of sharing one entry.
   */
  samFrameKey?: string | null,
): Promise<ProposeFrameMaskResult | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const box = normalizeObjectBox(selectionBox);
  const sourceFrame = preCapturedFrame ?? await captureVideoFrameAtTime(video, timeSec);

  let aiSnapshot: AlphaMask | null = null;

  // TEMP-DEBUG-SKELZONE — captured so the overlay can show WHERE each stage
  // landed. Remove with the grep tag.
  let dbgBounds: { x: number; y: number; w: number; h: number } | null = null;
  let dbgPersonMask: AlphaMask | null = null;
  let dbgCoreMask: AlphaMask | null = null;
  let dbgRacketMask: AlphaMask | null = null;

  // The skeleton used for the limit zone is the app's EXISTING one, handed in by
  // the caller in FULL-FRAME normalized coordinates. Nothing here crops, so there
  // is no crop→frame mapping to get wrong: the frame, the skeleton, the segmenter
  // output and the mask all live in one coordinate space.
  const guideScribble = scribble ?? null;
  const guideKeypoints = useSkeletonGuidance ? (skeletonKeypoints ?? null) : null;

  // Skeleton-shape settings for THIS frame, resolved ONCE. The segmenter crop,
  // the zone, the bone core and the debug overlay all read this same object, so
  // they cannot be built from different settings — the class of bug that made the
  // crop smaller than the shape it had to contain.
  //
  // Both opt-ins default OFF, in which case this is byte-for-byte the object the
  // pipeline has always passed.
  const shapeOpts = {
    ...(unitFloorNorm ? { unitFloorNorm } : {}),
    ...(autoArmRescueEnabled() ? { armRescue: ARM_RESCUE_TUNING } : {}),
    ...(autoHatAllowanceEnabled() ? { headTopExtraUnits: HAT_EXTRA_HEAD_UNITS } : {}),
  };

  // 0a. PERSON SEGMENTATION (MediaPipe Selfie Segmentation) around the ATHLETE.
  //
  //     The model's input is 256x256. Handed a whole 1080x1920 frame, an athlete
  //     occupying a fifth of it arrives about 50 model pixels wide — a forearm is
  //     under 5, and the gap between an arm and the torso is 3. At that scale the
  //     model cannot resolve anything finer than the skeleton capsules it is meant
  //     to refine, and on a small-in-frame subject it frequently reports nobody at
  //     all. That is what "SEGMENTER EMPTY on every frame" was.
  //
  //     So the model gets the athlete, not the scenery: the frame is cropped to the
  //     skeleton zone's own bounds (which already include the implement corridor),
  //     and the result is pasted back at the same rect.
  //
  //     THE COORDINATE RULE THAT MAKES THIS SAFE. The earlier crop attempt failed
  //     because the mask was CARRIED AROUND in crop space and mapped later, in
  //     several places. Here the crop exists for exactly two statements — take the
  //     sub-image, paste the answer back — using the same `embedRegionMask` every
  //     other rung already uses. Nothing downstream ever sees crop space: the mask,
  //     the zone, the frame and the intersection are all full-frame, so the AND
  //     below is still a plain index-wise walk over arrays of identical dimensions.
  //
  //     Picking the right human is still handled upstream by the app's existing
  //     skeleton (plus the coach's Lock tool); the crop only decides resolution.
  //
  //     KNOWN AND ACCEPTED FOR THIS PHASE: this model segments PEOPLE, so the
  //     racket may come back missing or partial. That is Phase B.
  if (useSkeletonGuidance) {
    try {
      const [{ segmentPersonInImage }, { skeletonShapeBounds }] = await Promise.all([
        import('@/lib/stroMotionDraft/selfieSegmenter'),
        import('@/lib/stroMotionDraft/skeletonMaskFilter'),
      ]);

      // Crop rect in FULL-FRAME pixels. Padded so the segmenter sees a little
      // context around the athlete rather than a shape flush against the edge,
      // and clamped to the frame. No pose ⇒ no bounds ⇒ segment the whole frame,
      // which is exactly the previous behaviour.
      // The crop scales from `unit` too, so a collapsed frame cropped the
      // segmenter down to a fraction of the athlete. Same batch reference.
      const zoneBounds = guideKeypoints
        ? skeletonShapeBounds(guideKeypoints, vw, vh, shapeOpts)
        : null;
      let rect: { x: number; y: number; w: number; h: number } | null = null;
      if (zoneBounds) {
        const padX = Math.round(zoneBounds.w * SEGMENT_CROP_PAD);
        const padY = Math.round(zoneBounds.h * SEGMENT_CROP_PAD);
        const x0 = Math.max(0, zoneBounds.x - padX);
        const y0 = Math.max(0, zoneBounds.y - padY);
        const x1 = Math.min(vw, zoneBounds.x + zoneBounds.w + padX);
        const y1 = Math.min(vh, zoneBounds.y + zoneBounds.h + padY);
        if (x1 - x0 >= 16 && y1 - y0 >= 16) rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      dbgBounds = rect; // TEMP-DEBUG-SKELZONE — the green rect in the panel.

      const input = rect
        ? await createImageBitmap(sourceFrame, rect.x, rect.y, rect.w, rect.h)
        : sourceFrame;
      let person: AlphaMask | null = null;
      try {
        person = await segmentPersonInImage(input);
      } finally {
        if (rect) { try { input.close(); } catch { /* already released */ } }
      }

      if (person) {
        // Back to full-frame space, immediately. `segmentPersonInImage` answers at
        // its input's dimensions; resample only if that ever stops being true, then
        // paste at the crop's origin (a no-op when there was no crop).
        const atInputSize = rect
          ? resampleAlphaMask(person, rect.w, rect.h)
          : resampleAlphaMask(person, vw, vh);
        const sized = rect
          ? embedRegionMask(vw, vh, rect.x, rect.y, atInputSize)
          : atInputSize;
        dbgPersonMask = sized; // TEMP-DEBUG-SKELZONE (pre-intersection)
        if (maskHasContent(sized)) aiSnapshot = sized;
      }
    } catch (e) {
      console.warn('[proposeFrameMask] person segmentation failed:', e);
      aiSnapshot = null; // fall through to the scribble segmenter below
    }
  }

  // 0b. Pose-anchored segmentation (MagicTouch) — retained as the fallback when
  //     person segmentation is unavailable or finds nobody. Unlike 0a this model
  //     is class-agnostic and prompted, so it can pick up the implement too.
  if (!maskHasContent(aiSnapshot) && guideScribble && guideScribble.length >= 2) {
    try {
      const { segmentSubjectMask } = await import('@/lib/mediapipeSegmenter');
      const seg = await segmentSubjectMask(sourceFrame, guideScribble, vw, vh);
      if (seg && maskHasContent(seg)) aiSnapshot = seg;
    } catch {
      aiSnapshot = null;
    }
  }

  // 1a. Motion diff against the temporal-MEDIAN plate — robust even when the
  //     object overlaps its own position in any single reference frame. Skipped
  //     when rung 0 (segmentation) already produced a mask.
  if (!maskHasContent(aiSnapshot) && backgroundPlate) {
    try {
      aiSnapshot = await motionDiffMaskInSelection(sourceFrame, backgroundPlate, box, vw, vh);
    } catch {
      aiSnapshot = null;
    }
  }

  // 1b. Single-reference-frame diff fallback (skip when the reference is
  //     effectively the same frame — nothing to diff).
  if ((!aiSnapshot || !maskHasContent(aiSnapshot)) && Math.abs(backgroundTimeSec - timeSec) > 0.05) {
    try {
      const backgroundFrame = await captureVideoFrameAtTime(video, backgroundTimeSec);
      try {
        aiSnapshot = await motionDiffMaskInSelection(sourceFrame, { bitmap: backgroundFrame, scale: 1 }, box, vw, vh);
      } finally {
        backgroundFrame.close();
      }
    } catch {
      aiSnapshot = null;
    }
  }

  // 2. Color flood-fill matte fallback, constrained to the selection box.
  if (!aiSnapshot || !maskHasContent(aiSnapshot)) {
    aiSnapshot = await matteMaskInSelection(sourceFrame, box, vw, vh);
  }

  // 2b. HARD LIMIT — the mask may only exist inside the thickened-skeleton zone.
  //
  //     final = segmenter_output ∩ zone, enforced. Placed AFTER every rung so it
  //     bounds whichever one produced the mask, and BEFORE the rung-3 guarantee so
  //     an empty result falls through to the box fill rather than to a blank frame.
  //
  //     There is NO path here that leaves a mask unbounded. Previously this block
  //     applied the filter only `if (filtered.applied)`, and the filter itself
  //     declined on a weak pose — so on precisely the frames where the segmenter
  //     grabs crowd and scenery, the unfiltered mask sailed through. In a
  //     StroMotion composite a single leaked blob overlays every later frame and
  //     hides the athlete, so the limit has to hold on every frame or it is not a
  //     limit. When no zone can be built, the coach's selection box is used as the
  //     boundary instead — weaker, but still hard.
  if (useSkeletonGuidance && aiSnapshot && maskHasContent(aiSnapshot)) {
    let bounded: AlphaMask | null = null;
    if (guideKeypoints) {
      try {
        const { filterMaskBySkeletonShape } = await import('@/lib/stroMotionDraft/skeletonMaskFilter');
        const filtered = filterMaskBySkeletonShape(aiSnapshot, guideKeypoints, shapeOpts);
        if (filtered.applied) {
          bounded = filtered.mask;
          dbgCoreMask = filtered.coreMask ?? null; // TEMP-DEBUG-SKELZONE
        }
      } catch {
        bounded = null;
      }
    }
    // No usable zone (pose too weak, or the filter threw) — fall back to the
    // selection box so the mask is still hard-bounded to what the coach chose.
    if (!bounded) bounded = intersectMaskWithBox(aiSnapshot, box, 0);
    aiSnapshot = bounded;
  }

  // 2b-fix. SKELETON-GUIDED INTERIOR HOLE FILL — opt-in, DEFAULT OFF.
  //
  //     Fills segmenter dropouts INSIDE the athlete: the patch of shorts or shirt
  //     the model lost, the strip between two legs that are close together. The
  //     same correction the coach makes with the Add brush.
  //
  //     HERE, on purpose. After 2b so it sees the FINAL person mask — zone-ANDed
  //     and bone-core-unioned — and before the racket rungs, so racket pixels can
  //     never close a loop against the body and manufacture a hole that was not
  //     the segmenter's doing.
  //
  //     A hole must be topologically ENCLOSED, fully inside the skeleton zone, and
  //     small relative to the athlete's own scale. Open gaps — legs apart, a raised
  //     arm — are not enclosed and are invisible to it by construction. Strictly
  //     additive and zone-bounded, so its worst case is a small kept patch the
  //     brush can undo; it can never cut the player. See maskAutoFix.ts.
  if (useSkeletonGuidance && guideKeypoints && aiSnapshot && autoFixHolesEnabled()) {
    try {
      const { fillSkeletonInteriorHoles } = await import('@/lib/stroMotionDraft/maskAutoFix');
      // Same shapeOpts, so the containment zone it tests against is the SAME zone
      // the mask was just ANDed with — including any hat allowance.
      const fixed = fillSkeletonInteriorHoles(aiSnapshot, guideKeypoints, vw, vh, shapeOpts);
      if (fixed.applied) aiSnapshot = fixed.mask;
      else if (fixed.skipReason) console.log(`[autoFixHoles] declined — ${fixed.skipReason}`);
    } catch (e) {
      // Optional corrections may never break the mask pipeline.
      console.warn('[autoFixHoles] failed — mask left unchanged:', e);
    }
  }

  // 2c. RACKET — a motion-difference candidate, unioned in AFTER the body zone.
  //
  //     AFTER, on purpose: the racket lives OUTSIDE the skeleton's body shape by
  //     definition, so running it before 2b would simply delete it. It is not
  //     unbounded, though — it carries its OWN containment (the tennis racket
  //     zones across BOTH arms) plus connectivity-to-a-hand and size gates, all
  //     of which fail closed. See racketCandidate.ts.
  //
  //     NOT a force-keep. The bone cores paint pixels because a tracked bone is
  //     evidence the athlete is there; nothing tracks the racket, so there is no
  //     evidence to force from. Here motion IS the evidence, and a frame without
  //     it gets no racket rather than an extrapolated one.
  //
  //     Off by default (`window.__stroRacket` / localStorage 'stroRacket').
  if (useSkeletonGuidance && guideKeypoints && aiSnapshot) {
    try {
      const { racketEnabled, buildRacketCandidate } = await import('@/lib/stroMotionDraft/racketCandidate');
      if (racketEnabled()) {
        const r = await buildRacketCandidate({
          sourceFrame,
          background: backgroundPlate ?? null,
          keypoints: guideKeypoints,
          vw,
          vh,
        });
        dbgRacketMask = r.mask; // TEMP-DEBUG-SKELZONE
        console.log(
          `[racket] ${r.reason} — found=${r.componentsFound} kept=${r.componentsKept} px=${r.keptPx}`,
        );
        if (r.mask) {
          // max(), like the bone-core union: where the segmenter already found
          // something its own (better-fitting) alpha wins, and the racket only
          // fills what was missing. Soft alpha preserved on both sides.
          const dst = aiSnapshot.data;
          const src = r.mask.data;
          if (src.length === dst.length) {
            for (let i = 0; i < dst.length; i++) if (src[i] > dst[i]) dst[i] = src[i];
          }
        }
      }
    } catch (e) {
      // Diagnostics and optional features must never break the mask pipeline.
      console.warn('[racket] candidate failed:', e);
    }
  }

  // 2d. AUTO-RACKET — D-FINE detects the implement, SAM-2 segments it.
  //
  //     AFTER the body zone for the same reason 2c is: the racket is outside the
  //     skeleton's shape by definition, so unioning it before 2b would delete it.
  //     Unioned with the SAME `unionRacketIntoMask` the coach's manual click uses,
  //     so an auto racket and a clicked one land in the mask identically.
  //
  //     THIS REPLACES THE CLICK AS A STARTING POINT, NOT AS A MECHANISM. The
  //     editor's Racket tool is untouched: the coach can still click to grow,
  //     correct or replace whatever this proposed, because both paths write the
  //     same soft-alpha union into the same working mask.
  //
  //     ORDERING IS THE COST CONTROL. Detection (~0.2–0.6s) runs FIRST and the
  //     SAM ENCODE (~4s WebGPU / ~9s wasm) is paid ONLY once a wrist-gated box
  //     exists — so a frame with no racket in it costs one detection and no SAM.
  //     The encode uses the CLICK PATH'S key and cache, so a frame auto-segmented
  //     here makes the Racket tool instant on it, and vice versa.
  //
  //     Fail-closed everywhere: no detector, no detection, nothing near a wrist,
  //     or an implausible mask ⇒ the frame is left exactly as rung 2c left it and
  //     the coach clicks. A wrong box would be worse than no box, because SAM
  //     would return a confident, cleanly-cut piece of the court.
  if (useSkeletonGuidance && guideKeypoints && samFrameKey && aiSnapshot && autoRacketEnabled(objectType)) {
    try {
      const { detectRacketBox } = await import('@/lib/stroMotionDraft/racketDetect');
      const hit = await detectRacketBox({
        frame: sourceFrame,
        keypoints: guideKeypoints,
        vw,
        vh,
        unitFloorNorm: unitFloorNorm ?? null,
        label: samFrameKey,
      });
      if (hit) {
        const { encodeFrameForRacket, decodeRacketMaskFromBox, unionRacketIntoMask } =
          await import('@/lib/stroMotionDraft/samRacket');
        const enc = await encodeFrameForRacket(samFrameKey, sourceFrame);
        if (enc) {
          const seg = await decodeRacketMaskFromBox(samFrameKey, hit.box);
          if (seg) {
            dbgRacketMask = seg.mask; // TEMP-DEBUG-SKELZONE
            aiSnapshot = unionRacketIntoMask(aiSnapshot, seg.mask);
            console.log(
              `[autoRacket] ${samFrameKey}: unioned ${hit.cls} (det ${hit.score.toFixed(3)}, ` +
              `SAM #${seg.chosen} ${seg.candidates[seg.chosen].areaPct.toFixed(2)}% of frame)`,
            );
          }
        } else {
          console.warn(`[autoRacket] ${samFrameKey}: SAM unavailable — detection found but not segmented`);
        }
      }
    } catch (e) {
      // Same rule as every optional pass: it may never break the mask pipeline.
      console.warn('[autoRacket] pass failed — frame keeps the manual click path:', e);
    }
  }

  // 3. Guaranteed non-empty proposal.
  if (!maskHasContent(aiSnapshot)) {
    aiSnapshot = fillBoxMask(vw, vh, box);
  }

  // TEMP-DEBUG-SKELZONE — render skeleton + zone + segmenter output over the
  // frame so the alignment (or lack of it) is visible. Remove with the grep tag.
  if (useSkeletonGuidance) {
    try {
      const [{ renderSkeletonDebug }, { buildSkeletonShapeRegion }] = await Promise.all([
        import('@/lib/stroMotionDraft/skeletonDebugOverlay'),
        import('@/lib/stroMotionDraft/skeletonMaskFilter'),
      ]);
      // Same batch reference the real zone above was built with, so the logged
      // unit= / headUnit= / headOval= numbers describe the zone that actually ran.
      const builtZone = guideKeypoints
        ? buildSkeletonShapeRegion(guideKeypoints, vw, vh, shapeOpts)
        : null;
      renderSkeletonDebug({
        label: `t=${timeSec.toFixed(2)}s`,
        sourceFrame,
        keypoints: guideKeypoints,
        zone: builtZone?.region ?? null,
        shapes: builtZone?.shapes ?? null,
        personMask: dbgPersonMask,
        bounds: dbgBounds,
        finalMask: aiSnapshot,
        coreMask: dbgCoreMask,
        racketMask: dbgRacketMask,
        racketAxis: racketAxis ?? null,
      });
    } catch { /* diagnostics must never break the pipeline */ }
  }

  return {
    sourceFrame,
    aiSnapshot,
    working: cloneAlphaMask(aiSnapshot),
  };
}
