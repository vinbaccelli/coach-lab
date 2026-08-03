'use client';

import { estimateTennisRacketZones, type PixelRect, type StroMotionPoseKeypoint } from '@/lib/stroMotionPose';
import { poseScaleUnit, type NormKeypoint } from '@/lib/stroMotionDraft/skeletonMaskFilter';
import { racketMode } from '@/lib/stroMotionDraft/racketTrajectory';
import { embedRegionMask } from '@/lib/stroMotionDraft/maskUtils';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * RACKET INCLUSION for Motion Layer — a motion-difference candidate, validated
 * before it is allowed to contribute a single pixel.
 *
 * WHY MOTION-DIFF AND NOT AN OBJECT DETECTOR
 * The racket is a HELD OBJECT: the skeleton does not track it, and the person
 * segmenter (legacy or multiclass) cannot return it because it is not a person.
 * COCO-SSD has a 'tennis racket' class, but a bounding box is the wrong SHAPE — a
 * racket at 45° fills roughly a third of its own box, so painting the box paints
 * background — and its reliability on fast, motion-blurred, edge-on frames is
 * unmeasured here. Against a static camera the racket is simply the thing that
 * MOVED, which needs no class label and yields a silhouette rather than a box.
 *
 * THE ASYMMETRY WITH BONE-CORE, WHICH THIS FILE MUST NOT BREAK
 * The bone cores FORCE pixels on, because a tracked bone is strong evidence the
 * athlete is there and the segmenter is simply wrong at that spot. The racket is
 * the opposite: nothing tracks it, so there is no evidence to force from. Here we
 * only ever ALLOW a region and require INDEPENDENT evidence (motion, plus
 * connectivity to the hand) to fill it. A frame with no motion evidence gets no
 * racket — never an extrapolated one.
 *
 * THE DOCTRINE: NO RACKET BEATS A WRONG RACKET.
 * In a Motion Layer composite every ghost overlays every later frame, so a single
 * phantom on one frame is visible across the whole layer, while a missing racket
 * on one frame is invisible. Every gate below therefore fails CLOSED.
 */

/** Runtime toggle — default OFF, so nothing changes until we opt in. */
export const RACKET_STORAGE_KEY = 'stroRacket';

/**
 * Is THIS detector — the motion-diff blob one in this file — switched on?
 *
 *   window.__stroRacket = true
 *   localStorage.setItem('stroRacket', 'blob')   // survives reload, crosses realms
 *   localStorage.removeItem('stroRacket')        // back to default (off)
 *
 * The switch became three-state when the trajectory work landed ('off' | 'blob' |
 * 'arc'); the parsing lives in racketTrajectory.ts so there is ONE reader of the
 * key rather than two that can disagree. 'on' / 'true' / '1' still resolve to
 * 'blob', so every existing switch keeps its exact previous meaning.
 *
 * 'arc' returns FALSE here on purpose: that mode draws the trajectory axis and
 * masks nothing, so this detector must stay out of the way entirely.
 */
export function racketEnabled(): boolean {
  return racketMode() === 'blob';
}

// ── Tuning ─────────────────────────────────────────────────────────────────
// The diff thresholds and morphology mirror `motionDiffMaskInSelection` in
// proposeFrameMask.ts, which is the reviewed implementation of this technique —
// deliberately the same numbers so the two behave alike on the same footage.
// This is a SEPARATE implementation rather than a call into that function
// because its component rule keeps blobs near the SELECTION-BOX CENTRE, and for
// a racket that rule would keep whatever sits mid-zone rather than what is
// attached to the hand — precisely the phantom this file exists to prevent.
const T_LOW = 30;                  // below: definitely background
const T_HIGH = 70;                 // above: definitely moved
const WORK_MAX_EDGE = 420;         // processing resolution cap

/** A component must be at least this fraction INSIDE the racket zones, or it is DISCARDED. */
const ZONE_CONTAINMENT_MIN = 0.9;
/** Wrist-disc radius as a multiple of the pose scale unit (shoulder width). */
const WRIST_DISC_UNIT = 0.30;
const WRIST_DISC_MIN_PX = 12;
/** Component bounding-box diagonal bounds, as multiples of the pose scale unit. */
const MIN_DIAG_UNIT = 0.35;        // below this it is speckle, not a racket
const MAX_DIAG_UNIT = 3.0;         // above this it is leaked background, not a racket
/** Absolute speckle floor, in working-resolution pixels. */
const MIN_COMPONENT_PX = 12;
/** If the kept area covers more than this share of the zone, the diff is untrustworthy. */
const MAX_KEPT_ZONE_FRACTION = 0.6;
/** Outer fraction of the racket alpha that ramps to zero, matching the bone-core feather. */
const EDGE_FEATHER_PASSES = 1;

export interface RacketCandidateResult {
  /** Full-frame soft alpha of the validated racket, or null when nothing qualified. */
  mask: AlphaMask | null;
  /** Human-readable outcome for the diagnostic log. */
  reason: string;
  componentsFound: number;
  componentsKept: number;
  keptPx: number;
}

const EMPTY = (reason: string): RacketCandidateResult => ({
  mask: null, reason, componentsFound: 0, componentsKept: 0, keptPx: 0,
});

function unionRects(rects: PixelRect[]): PixelRect | null {
  let u: PixelRect | null = null;
  for (const r of rects) {
    u = u ? { x0: Math.min(u.x0, r.x0), y0: Math.min(u.y0, r.y0), x1: Math.max(u.x1, r.x1), y1: Math.max(u.y1, r.y1) } : r;
  }
  return u;
}

/**
 * Build the validated racket contribution for one frame, in FULL-FRAME space.
 *
 * Returns `mask: null` for every uncertain case — no plate, no pose, no motion,
 * nothing connected to a hand, implausible size, or a diff that went blown-out.
 * The caller unions a non-null result into the mask AFTER the person-segmentation
 * ∩ skeleton-zone step, so the body zone cannot delete it (the racket lives
 * outside the body by definition) and it carries its OWN containment.
 */
export async function buildRacketCandidate(input: {
  sourceFrame: ImageBitmap;
  /** Temporal-median background plate. Required — motion-diff has no meaning without it. */
  background: { bitmap: ImageBitmap; scale: number } | null | undefined;
  /** The frame-exact skeleton, FULL-FRAME NORMALIZED (same array the zone is built from). */
  keypoints: NormKeypoint[] | null | undefined;
  vw: number;
  vh: number;
}): Promise<RacketCandidateResult> {
  const { sourceFrame, background, keypoints, vw, vh } = input;

  // GATE 0 — the technique's precondition. Motion-diff compares against a
  // static-camera plate; with no plate there is no evidence, so draw nothing.
  if (!background) return EMPTY('no background plate');
  if (!keypoints || keypoints.length < 17) return EMPTY('no pose');
  if (vw < 16 || vh < 16) return EMPTY('frame too small');

  const scale = poseScaleUnit(keypoints, vw, vh);
  if (!scale) return EMPTY('pose too weak for a scale unit');
  const unit = scale.unit;

  // Pixel-space pose for the tennis-aware zone builder, which already covers
  // BOTH arms and merges a two-handed grip — the single-dominant-wrist anchor
  // used elsewhere flips hands frequently on real footage and is structurally
  // biased toward the extended balance arm.
  const kpsPx: StroMotionPoseKeypoint[] = keypoints.map((k) => ({
    x: k.x * vw, y: k.y * vh, score: k.score, name: k.name ?? '',
  }));
  const zoneRects = estimateTennisRacketZones(kpsPx, vw, vh).zones;
  if (!zoneRects.length) return EMPTY('no racket zones (arms not visible)');

  const bounds = unionRects(zoneRects);
  if (!bounds) return EMPTY('no racket zone bounds');
  const rx = Math.max(0, Math.floor(bounds.x0));
  const ry = Math.max(0, Math.floor(bounds.y0));
  const rw = Math.min(vw, Math.ceil(bounds.x1)) - rx;
  const rh = Math.min(vh, Math.ceil(bounds.y1)) - ry;
  if (rw < 8 || rh < 8) return EMPTY('racket zone degenerate');

  // ── Motion difference inside the racket-zone bounds ──────────────────────
  const s = Math.min(1, WORK_MAX_EDGE / Math.max(rw, rh));
  const w = Math.max(8, Math.round(rw * s));
  const h = Math.max(8, Math.round(rh * s));
  const cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return EMPTY('no 2d context');

  ctx.drawImage(sourceFrame, rx, ry, rw, rh, 0, 0, w, h);
  const cur = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  const bs = background.scale;
  ctx.drawImage(background.bitmap, rx * bs, ry * bs, rw * bs, rh * bs, 0, 0, w, h);
  const bg = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const soft = new Uint8ClampedArray(n);   // motion-blur-preserving soft alpha
  const core = new Uint8Array(n);          // confident-motion binary core
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d =
      Math.abs(cur.data[o] - bg.data[o]) +
      Math.abs(cur.data[o + 1] - bg.data[o + 1]) +
      Math.abs(cur.data[o + 2] - bg.data[o + 2]);
    const tRaw = (d - T_LOW) / (T_HIGH - T_LOW);
    const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw * tRaw * (3 - 2 * tRaw);
    soft[i] = Math.round(t * 255);
    core[i] = d > T_HIGH ? 1 : 0;
  }

  const morph = (src: Uint8Array, op: 'erode' | 'dilate'): Uint8Array => {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = op === 'erode' ? 1 : 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            const sv = yy < 0 || xx < 0 || yy >= h || xx >= w ? 0 : src[yy * w + xx];
            if (op === 'erode') v = Math.min(v, sv); else v = Math.max(v, sv);
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  // Open: kills pixel speckle without eroding a real racket away.
  let m = morph(core, 'erode');
  m = morph(m, 'dilate');

  // ── Zone membership + wrist discs, at working resolution ─────────────────
  const toWorkX = (px: number) => (px - rx) * s;
  const toWorkY = (py: number) => (py - ry) * s;

  const inZone = new Uint8Array(n);
  let zonePx = 0;
  for (const r of zoneRects) {
    const x0 = Math.max(0, Math.floor(toWorkX(r.x0)));
    const y0 = Math.max(0, Math.floor(toWorkY(r.y0)));
    const x1 = Math.min(w - 1, Math.ceil(toWorkX(r.x1)));
    const y1 = Math.min(h - 1, Math.ceil(toWorkY(r.y1)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!inZone[i]) { inZone[i] = 1; zonePx++; }
      }
    }
  }
  if (zonePx === 0) return EMPTY('racket zone empty at working resolution');

  // Wrist discs — BOTH hands. A one-handed grip leaves the other disc unused;
  // a two-handed grip is covered twice. Either way the racket must touch one.
  const discR = Math.max(WRIST_DISC_MIN_PX, unit * WRIST_DISC_UNIT) * s;
  const discs: Array<{ cx: number; cy: number }> = [];
  for (const idx of [9, 10]) {
    const k = keypoints[idx];
    if (!k || k.score < 0.2) continue;
    discs.push({ cx: toWorkX(k.x * vw), cy: toWorkY(k.y * vh) });
  }
  if (!discs.length) return EMPTY('no confident wrist to anchor to');

  // ── Connected components on the opened core ──────────────────────────────
  const labels = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  type Comp = { px: number; inZonePx: number; touchesHand: boolean; minX: number; maxX: number; minY: number; maxY: number };
  const comps: Comp[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (!m[i0] || labels[i0] !== -1) continue;
    const id = comps.length;
    const c: Comp = { px: 0, inZonePx: 0, touchesHand: false, minX: w, maxX: 0, minY: h, maxY: 0 };
    stack.push(i0);
    labels[i0] = id;
    while (stack.length) {
      const p = stack.pop() as number;
      const px = p % w, py = (p / w) | 0;
      c.px++;
      if (inZone[p]) c.inZonePx++;
      if (px < c.minX) c.minX = px;
      if (px > c.maxX) c.maxX = px;
      if (py < c.minY) c.minY = py;
      if (py > c.maxY) c.maxY = py;
      if (!c.touchesHand) {
        for (const d of discs) {
          if (Math.hypot(px - d.cx, py - d.cy) <= discR) { c.touchesHand = true; break; }
        }
      }
      if (px > 0 && m[p - 1] && labels[p - 1] === -1) { labels[p - 1] = id; stack.push(p - 1); }
      if (px < w - 1 && m[p + 1] && labels[p + 1] === -1) { labels[p + 1] = id; stack.push(p + 1); }
      if (py > 0 && m[p - w] && labels[p - w] === -1) { labels[p - w] = id; stack.push(p - w); }
      if (py < h - 1 && m[p + w] && labels[p + w] === -1) { labels[p + w] = id; stack.push(p + w); }
    }
    comps.push(c);
  }
  if (!comps.length) return EMPTY('no motion in the racket zone');

  // ── THE GATES. Every one fails closed. ───────────────────────────────────
  const unitWork = unit * s;
  const keep: boolean[] = comps.map((c) => {
    // 1. HARD CONTAINMENT — discarded, not clipped. A blob straddling the zone
    //    edge is not a racket that stuck out; it is something else that reached in.
    if (c.inZonePx / Math.max(1, c.px) < ZONE_CONTAINMENT_MIN) return false;
    // 2. CONNECTIVITY TO A HAND — this is what rejects the opponent's racket, a
    //    ball, a line judge, a wind-blown net: none of them touch THIS hand.
    if (!c.touchesHand) return false;
    // 3. PLAUSIBLE SIZE, BOTH BOUNDS.
    if (c.px < MIN_COMPONENT_PX) return false;
    const diag = Math.hypot(c.maxX - c.minX + 1, c.maxY - c.minY + 1);
    if (diag < unitWork * MIN_DIAG_UNIT) return false;
    if (diag > unitWork * MAX_DIAG_UNIT) return false;
    return true;
  });

  const keptIdx = keep.reduce<number[]>((a, k, i) => (k ? [...a, i] : a), []);
  if (!keptIdx.length) {
    return { mask: null, reason: 'no component passed the gates', componentsFound: comps.length, componentsKept: 0, keptPx: 0 };
  }

  let keptPx = 0;
  for (const i of keptIdx) keptPx += comps[i].px;
  // Blown-out diff guard: a camera nudge or exposure shift lights up the whole
  // zone, and every "component" then looks connected to the hand.
  if (keptPx / zonePx > MAX_KEPT_ZONE_FRACTION) {
    return { mask: null, reason: `diff blown out (${Math.round((keptPx / zonePx) * 100)}% of zone)`, componentsFound: comps.length, componentsKept: 0, keptPx: 0 };
  }

  // ── Build the soft alpha from the SURVIVING components only ──────────────
  const keepSet = new Set(keptIdx);
  const support = morph(
    Uint8Array.from(labels, (l) => (l >= 0 && keepSet.has(l) ? 1 : 0)),
    'dilate',
  );
  let out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = support[i] ? soft[i] : 0;
  // Feather so the racket meets the segmenter's edge without a hard seam — the
  // same reason the bone cores ramp rather than ending square.
  for (let pass = 0; pass < EDGE_FEATHER_PASSES; pass++) {
    const blur = new Uint8ClampedArray(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            acc += out[yy * w + xx]; cnt++;
          }
        }
        blur[y * w + x] = Math.round(acc / cnt);
      }
    }
    out = blur;
  }

  // Upscale (nearest) back to the zone crop, then embed at full-frame position.
  const up = new Uint8ClampedArray(rw * rh);
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / rh));
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / rw));
      up[y * rw + x] = out[sy * w + sx];
    }
  }
  const mask = embedRegionMask(vw, vh, rx, ry, { width: rw, height: rh, data: up });
  return {
    mask,
    reason: 'ok',
    componentsFound: comps.length,
    componentsKept: keptIdx.length,
    keptPx: Math.round(keptPx / (s * s)),
  };
}
