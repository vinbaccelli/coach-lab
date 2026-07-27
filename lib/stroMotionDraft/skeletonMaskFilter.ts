'use client';

import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * Skeleton-guided cleanup of an AI mask — SHAPE-AWARE.
 *
 * WHY THIS SHAPE, NOT PROXIMITY
 * The first version of this filter kept mask components within a radius of any
 * skeleton JOINT. That reliably dropped detached foliage, but it could not drop
 * the chunk of background BETWEEN a raised arm and the torso: that gap sits well
 * inside the discs centred on the shoulder and the elbow, so it read as "near the
 * skeleton" and survived.
 *
 * A human looking at a skeleton does not think "near a joint" — they read the
 * BONES. The body is a band of some width around each bone segment: forearms
 * thin, thighs thicker, torso a filled slab, head a blob. The space between the
 * arms is close to two joints but far from every actual bone, which is exactly
 * what makes it separable.
 *
 * So this builds a player-shaped region from capsules (thick line segments) along
 * the skeleton's bones, plus a torso slab and a head blob, and keeps only mask
 * pixels inside it.
 *
 * TUNING
 * Every width is a multiple of the athlete's own SHOULDER WIDTH, so the shape
 * scales with how large they appear in frame. All of them live in
 * `DEFAULT_CAPSULE_WIDTHS` below and can be overridden per call. Widen if the
 * filter clips loose clothing or an extended arm; narrow if background survives.
 *
 * FAIL-SAFE
 * Anything uncertain — too few keypoints, no shoulders to scale from, or a result
 * that would keep almost nothing — returns the input mask untouched with
 * `applied: false`. Deleting the athlete is far worse than keeping a tree, and
 * the manual brush is the backstop either way.
 */

/** COCO-17 keypoint, in FULL-FRAME NORMALIZED [0,1] coordinates. */
export interface NormKeypoint {
  x: number;
  y: number;
  score: number;
}

/** COCO-17 indices (MoveNet / MediaPipe order). */
const NOSE = 0;
const L_SHOULDER = 5, R_SHOULDER = 6;
const L_ELBOW = 7, R_ELBOW = 8;
const L_WRIST = 9, R_WRIST = 10;
const L_HIP = 11, R_HIP = 12;
const L_KNEE = 13, R_KNEE = 14;
const L_ANKLE = 15, R_ANKLE = 16;

/** Repo-wide joint visibility gate (matches MIN_POSE_SCORE in lib/stroMotionPose.ts). */
const MIN_SCORE = 0.2;

/**
 * Half-widths as multiples of the athlete's shoulder width.
 *
 * Defaults lean GENEROUS on purpose: over-keeping a little background is a minor
 * annoyance the coach can brush away, whereas clipping through the player's torso
 * is a visible defect that makes the layer unusable.
 */
export interface CapsuleWidths {
  /** shoulder→elbow, hip→knee are the thicker limb halves. */
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
  /** Slab around the shoulders/hips quad — covers the shirt. */
  torso: number;
  /** Head blob radius, centred on the nose (covers hair/cap). */
  head: number;
  /** nose→shoulder-midpoint, so the head joins the torso. */
  neck: number;
  /**
   * Disc at each ankle. COCO-17 has no toe keypoint, and the shin capsule stops
   * AT the ankle joint — so without this the foot falls outside the keep region
   * and gets clipped off a perfectly good segmentation. A disc is used rather
   * than a directed capsule because the foot's heading is unknown (and changes
   * through a stride), so orientation-agnostic coverage is the safe choice.
   */
  foot: number;
  /** wrist→implement tip, so the racket is not amputated. */
  implement: number;
}

export const DEFAULT_CAPSULE_WIDTHS: CapsuleWidths = {
  upperArm: 0.34,
  forearm: 0.28,
  thigh: 0.42,
  shin: 0.30,
  torso: 0.34,
  head: 0.62,
  neck: 0.30,
  foot: 0.42,
  implement: 0.26,
};

export interface SkeletonShapeOptions {
  widths?: Partial<CapsuleWidths>;
  /**
   * How far past the wrist the implement capsule reaches, as a multiple of the
   * forearm length. Mirrors poseScribble's own 1.2 extrapolation so the racket
   * region agrees with the scribble that prompted the segmenter.
   */
  implementReach?: number;
  // NOTE: there is deliberately NO "skip if it keeps too little" option. The zone
  // is a hard limit; an escape hatch is what let stray blobs through before.
}

export interface SkeletonFilterResult {
  mask: AlphaMask;
  /** False when the filter declined to act (and `mask` is the input, unchanged). */
  applied: boolean;
  keptPx: number;
  droppedPx: number;
  /** Area of the generated player-shape region, in px. */
  shapePx: number;
  /** Set when `applied` is false — why it declined. */
  skipReason?: string;
}

const DEFAULT_IMPLEMENT_REACH = 1.2;

interface Pt { x: number; y: number }

/** Visible joint in mask-pixel space, or null. */
function joint(kps: NormKeypoint[], idx: number, w: number, h: number): Pt | null {
  const k = kps[idx];
  if (!k || k.score < MIN_SCORE) return null;
  return { x: k.x * w, y: k.y * h };
}

/** Mark every pixel within `halfWidth` of segment a→b. Iterates the segment's
 *  bounding box only, so cost is proportional to the capsule, not the frame. */
function stampCapsule(region: Uint8Array, w: number, h: number, a: Pt, b: Pt, halfWidth: number): void {
  if (halfWidth <= 0) return;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - halfWidth));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + halfWidth));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - halfWidth));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + halfWidth));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const r2 = halfWidth * halfWidth;

  for (let y = y0; y <= y1; y++) {
    const rowBase = y * w;
    for (let x = x0; x <= x1; x++) {
      // Distance from the pixel to the SEGMENT (t clamped to [0,1], so the ends
      // are round caps rather than an infinite line).
      const px = x - a.x;
      const py = y - a.y;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0;
      const cx = px - t * dx;
      const cy = py - t * dy;
      if (cx * cx + cy * cy <= r2) region[rowBase + x] = 1;
    }
  }
}

/** Even-odd point-in-polygon, for the torso quad. */
function pointInPolygon(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Fill the torso quad's interior. Its EDGES are stamped as capsules separately,
 *  which together give a slab that is the quad dilated outward by `halfWidth`. */
function stampPolygonInterior(region: Uint8Array, w: number, h: number, poly: Pt[]): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(w - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const rowBase = y * w;
    for (let x = x0; x <= x1; x++) {
      if (pointInPolygon(poly, x, y)) region[rowBase + x] = 1;
    }
  }
}

/**
 * Rasterize the player-shape region from a pose. Exported so it can be tested and
 * inspected independently of any mask.
 *
 * Returns null when the pose is too weak to build a body from.
 */
export function buildSkeletonShapeRegion(
  keypoints: NormKeypoint[] | null | undefined,
  width: number,
  height: number,
  opts: SkeletonShapeOptions = {},
): { region: Uint8Array; shapePx: number } | null {
  if (!keypoints || keypoints.length < 17 || width < 1 || height < 1) return null;

  const W = { ...DEFAULT_CAPSULE_WIDTHS, ...(opts.widths ?? {}) };
  const J = (i: number) => joint(keypoints, i, width, height);

  const ls = J(L_SHOULDER), rs = J(R_SHOULDER);
  const lh = J(L_HIP), rh = J(R_HIP);

  // Shoulder width is the scale unit for every capsule. Fall back to hip width,
  // then to the whole-pose bbox, so a partly-occluded athlete still gets a shape.
  let unit = 0;
  if (ls && rs) unit = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (unit < 1 && lh && rh) unit = Math.hypot(lh.x - rh.x, lh.y - rh.y);
  if (unit < 1) {
    const vis = keypoints.filter((k) => k.score >= MIN_SCORE);
    if (vis.length < 3) return null;
    const xs = vis.map((k) => k.x * width);
    const ys = vis.map((k) => k.y * height);
    unit = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.25;
  }
  if (unit < 1) return null;

  const region = new Uint8Array(width * height);

  // ── Limbs ────────────────────────────────────────────────────────────────
  const limbs: Array<[number, number, number]> = [
    [L_SHOULDER, L_ELBOW, W.upperArm], [L_ELBOW, L_WRIST, W.forearm],
    [R_SHOULDER, R_ELBOW, W.upperArm], [R_ELBOW, R_WRIST, W.forearm],
    [L_HIP, L_KNEE, W.thigh], [L_KNEE, L_ANKLE, W.shin],
    [R_HIP, R_KNEE, W.thigh], [R_KNEE, R_ANKLE, W.shin],
  ];
  for (const [ia, ib, mult] of limbs) {
    const a = J(ia), b = J(ib);
    if (a && b) stampCapsule(region, width, height, a, b, unit * mult);
  }

  // ── Torso: the shoulders/hips quad, filled and dilated by the edge capsules ──
  const torso = [ls, rs, rh, lh].filter(Boolean) as Pt[];
  if (torso.length === 4) {
    stampPolygonInterior(region, width, height, torso);
    for (let i = 0; i < 4; i++) {
      stampCapsule(region, width, height, torso[i], torso[(i + 1) % 4], unit * W.torso);
    }
  } else if (ls && rs) {
    stampCapsule(region, width, height, ls, rs, unit * W.torso);
  }

  // ── Feet — a disc past each ankle, since the shin capsule stops at the joint ──
  for (const ai of [L_ANKLE, R_ANKLE] as const) {
    const a = J(ai);
    if (a) stampCapsule(region, width, height, a, a, unit * W.foot);
  }

  // ── Head + neck ──────────────────────────────────────────────────────────
  const nose = J(NOSE);
  if (nose) {
    stampCapsule(region, width, height, nose, nose, unit * W.head); // degenerate = disc
    if (ls && rs) {
      const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
      stampCapsule(region, width, height, nose, mid, unit * W.neck);
    }
  }

  // ── Implement (racket/bat) — wrist extended past the elbow ────────────────
  // Without this the shape filter would cut the racket off, which is precisely
  // the part of the layer the coach cares about most.
  const reach = opts.implementReach ?? DEFAULT_IMPLEMENT_REACH;
  for (const [wi, ei] of [[L_WRIST, L_ELBOW], [R_WRIST, R_ELBOW]] as const) {
    const wr = J(wi), el = J(ei);
    if (!wr || !el) continue;
    const tip = { x: wr.x + (wr.x - el.x) * reach, y: wr.y + (wr.y - el.y) * reach };
    stampCapsule(region, width, height, wr, tip, unit * W.implement);
  }

  let shapePx = 0;
  for (let i = 0; i < region.length; i++) if (region[i]) shapePx++;
  if (shapePx === 0) return null;

  return { region, shapePx };
}

/**
 * Bounding box of the shape region, computed ANALYTICALLY (no rasterization).
 *
 * Used to crop the frame before running a segmentation model: the crop must
 * contain everything the shape could contain, including the implement corridor
 * past the wrist — cropping to the pose's joints alone would slice the racket off
 * before the segmenter ever saw it.
 *
 * Returns null when the pose is too weak, and always stays inside the frame.
 */
export function skeletonShapeBounds(
  keypoints: NormKeypoint[] | null | undefined,
  width: number,
  height: number,
  opts: SkeletonShapeOptions = {},
): { x: number; y: number; w: number; h: number } | null {
  if (!keypoints || keypoints.length < 17 || width < 1 || height < 1) return null;
  const W = { ...DEFAULT_CAPSULE_WIDTHS, ...(opts.widths ?? {}) };
  const J = (i: number) => joint(keypoints, i, width, height);

  const ls = J(L_SHOULDER), rs = J(R_SHOULDER), lh = J(L_HIP), rh = J(R_HIP);
  let unit = 0;
  if (ls && rs) unit = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (unit < 1 && lh && rh) unit = Math.hypot(lh.x - rh.x, lh.y - rh.y);
  if (unit < 1) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (p: Pt, pad: number) => {
    if (p.x - pad < minX) minX = p.x - pad;
    if (p.x + pad > maxX) maxX = p.x + pad;
    if (p.y - pad < minY) minY = p.y - pad;
    if (p.y + pad > maxY) maxY = p.y + pad;
  };

  // Widest per-joint pad: whichever capsule touching it is thickest.
  const jointPad: Record<number, number> = {
    [NOSE]: W.head,
    [L_SHOULDER]: Math.max(W.upperArm, W.torso), [R_SHOULDER]: Math.max(W.upperArm, W.torso),
    [L_ELBOW]: W.upperArm, [R_ELBOW]: W.upperArm,
    [L_WRIST]: Math.max(W.forearm, W.implement), [R_WRIST]: Math.max(W.forearm, W.implement),
    [L_HIP]: Math.max(W.thigh, W.torso), [R_HIP]: Math.max(W.thigh, W.torso),
    [L_KNEE]: W.thigh, [R_KNEE]: W.thigh,
    [L_ANKLE]: Math.max(W.shin, W.foot), [R_ANKLE]: Math.max(W.shin, W.foot),
  };
  let any = false;
  for (const idxStr of Object.keys(jointPad)) {
    const idx = Number(idxStr);
    const p = J(idx);
    if (!p) continue;
    any = true;
    grow(p, unit * jointPad[idx]);
  }
  if (!any) return null;

  // Implement tips — the reason this function exists rather than using a joint bbox.
  const reach = opts.implementReach ?? DEFAULT_IMPLEMENT_REACH;
  for (const [wi, ei] of [[L_WRIST, L_ELBOW], [R_WRIST, R_ELBOW]] as const) {
    const wr = J(wi), el = J(ei);
    if (!wr || !el) continue;
    grow({ x: wr.x + (wr.x - el.x) * reach, y: wr.y + (wr.y - el.y) * reach }, unit * W.implement);
  }

  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(width, Math.ceil(maxX));
  const y1 = Math.min(height, Math.ceil(maxY));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 || h < 8) return null;
  return { x: x0, y: y0, w, h };
}

/**
 * Keep mask pixels inside the skeleton's player-shape region; drop the rest.
 *
 * `keypoints` are COCO-17 in FULL-FRAME normalized coordinates — the space
 * the app's existing skeleton is supplied in (page.tsx normalizes it).
 */
export function filterMaskBySkeletonShape(
  mask: AlphaMask,
  keypoints: NormKeypoint[] | null | undefined,
  opts: SkeletonShapeOptions = {},
): SkeletonFilterResult {
  const base: Omit<SkeletonFilterResult, 'skipReason'> = {
    mask, applied: false, keptPx: 0, droppedPx: 0, shapePx: 0,
  };

  const { width, height, data } = mask;
  if (width < 1 || height < 1 || data.length !== width * height) {
    return { ...base, skipReason: 'malformed mask' };
  }

  const built = buildSkeletonShapeRegion(keypoints, width, height, opts);
  if (!built) return { ...base, skipReason: 'pose too weak to build a body shape' };
  const { region, shapePx } = built;

  let hasContent = false;
  for (let i = 0; i < data.length; i++) { if (data[i] > 0) { hasContent = true; break; } }
  if (!hasContent) return { ...base, shapePx, skipReason: 'mask has no content' };

  // STRICT AND. Once a zone exists, every pixel outside it is dropped —
  // unconditionally, with no escape hatch.
  //
  // This used to bail out and return the mask UNFILTERED when the intersection
  // kept less than `minKeepFraction`, on the theory that a tiny survivor meant
  // the pose and the mask disagreed and the frame was safer left alone. That
  // theory was wrong in the way that matters: the frames where the pose is
  // poorest are exactly the frames where the segmenter grabs crowd and scenery,
  // so the bail-out handed through the *worst* masks intact. In a StroMotion
  // composite one such frame's stray blob sits on top of every later frame and
  // hides the athlete. An over-tight mask costs the coach a few brush strokes;
  // a leaked blob spoils the whole layer.
  const out = new Uint8ClampedArray(width * height);
  let keptPx = 0;
  let droppedPx = 0;
  for (let i = 0; i < out.length; i++) {
    if (data[i] <= 0) continue;
    if (region[i]) {
      out[i] = data[i]; // preserve soft alpha — do not re-binarize
      keptPx++;
    } else {
      droppedPx++;
    }
  }

  return {
    mask: { width, height, data: out },
    applied: true,
    keptPx,
    droppedPx,
    shapePx,
  };
}
