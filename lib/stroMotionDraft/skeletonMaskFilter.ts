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
 * thin, thighs thicker, torso a filled slab, head an upright oval. The space between the
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
 * `thicknessScale` (default `DEFAULT_ZONE_THICKNESS_SCALE`) trims or fattens all
 * of them at once, for when the whole zone is a little off rather than one bone.
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
  /**
   * Head oval, LONG (top-of-head→chin) semi-axis. Paired with `headWidth` below.
   *
   * This used to be a plain disc radius centred on the nose. A disc big enough to
   * cover the skull top-to-chin is necessarily that wide SIDEWAYS too, so it hauled
   * in a ring of background either side of the head that nothing on the body needs.
   * A head is taller than it is wide, so the zone is now an ellipse of the same
   * long extent and a narrower cross-axis — same coverage, less overreach.
   */
  head: number;
  /** Head oval, SHORT (ear→ear) semi-axis. Keep below `head` or it stops being head-shaped. */
  headWidth: number;
  /** nose→shoulder anchor (and a little past it), so the head joins the torso. */
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
  headWidth: 0.42,
  neck: 0.30,
  foot: 0.42,
  implement: 0.26,
};

export interface SkeletonShapeOptions {
  widths?: Partial<CapsuleWidths>;
  /**
   * ONE dial that scales every thickness in `CapsuleWidths` at once — limbs, torso,
   * neck, feet, implement and both head semi-axes. Defaults to
   * `DEFAULT_ZONE_THICKNESS_SCALE`; set 1 to get the raw per-bone widths back.
   * Trimming the whole zone is a single-number decision, so it is a single number
   * rather than nine edited constants that can drift apart.
   */
  thicknessScale?: number;
  /**
   * How far the head oval's BASE sits above the shoulder midpoint, along the
   * shoulder line's normal, as a multiple of shoulder width. Zero puts the oval's
   * lower vertex exactly on the midpoint, which is the intent — the head rises
   * straight up out of the shoulders. Raise it if the oval reaches too far down
   * into the chest; lower it (negative is allowed) to bias coverage downward.
   * NOT affected by `thicknessScale` — it is a position, not a thickness.
   */
  headBaseOffset?: number;
  /**
   * How far past the wrist the implement capsule reaches, as a multiple of the
   * forearm length. Mirrors poseScribble's own 1.2 extrapolation so the racket
   * region agrees with the scribble that prompted the segmenter.
   */
  implementReach?: number;
  /**
   * How far the neck capsule pushes PAST its shoulder anchor and on into the
   * chest, as a multiple of the nose→anchor length. Small on purpose: enough to
   * overlap the torso slab rather than butt against its top edge, not enough to
   * reach anything that is not already torso.
   */
  neckOvershoot?: number;
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
const DEFAULT_NECK_OVERSHOOT = 0.35;
/** Global trim on every capsule/oval half-width. 0.95 = 5% thinner than the raw widths. */
export const DEFAULT_ZONE_THICKNESS_SCALE = 0.95;
const DEFAULT_HEAD_BASE_OFFSET = 0;
/**
 * Guards on the shoulder line before its normal is trusted as the head's up
 * direction: a normal taken from a few px of baseline is noise, and would spin the
 * head oval. Screen-vertical is the fallback, which is right for almost every
 * frame anyway.
 *
 * TWO tests, because neither covers the other. The relative one only bites when
 * `unit` came from the HIP fallback — with both shoulders visible `unit` IS the
 * shoulder distance, so that comparison is trivially true. The absolute one is
 * what catches a genuinely collapsed shoulder line when there are no hips to
 * rescale from.
 */
const MIN_SHOULDER_LINE_LENGTH = 0.25;
const MIN_SHOULDER_LINE_PX = 4;

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

/**
 * Mark every pixel inside an ellipse centred at `c`, with `semiMajor` measured
 * along the unit vector `axis` and `semiMinor` across it. Used for the head, whose
 * long axis follows the neck→nose direction so the oval leans with the head instead
 * of staying stubbornly upright when the athlete does not.
 *
 * Like stampCapsule, it walks only the shape's bounding box.
 */
function stampEllipse(
  region: Uint8Array, w: number, h: number,
  c: Pt, axis: Pt, semiMajor: number, semiMinor: number,
): void {
  if (semiMajor <= 0 || semiMinor <= 0) return;
  // A rotated ellipse never reaches further than its longest semi-axis in any
  // direction, so that is a safe (if slightly loose) box.
  const reach = Math.max(semiMajor, semiMinor);
  const x0 = Math.max(0, Math.floor(c.x - reach));
  const x1 = Math.min(w - 1, Math.ceil(c.x + reach));
  const y0 = Math.max(0, Math.floor(c.y - reach));
  const y1 = Math.min(h - 1, Math.ceil(c.y + reach));
  const a2 = semiMajor * semiMajor;
  const b2 = semiMinor * semiMinor;

  for (let y = y0; y <= y1; y++) {
    const rowBase = y * w;
    const dy = y - c.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - c.x;
      // Project into the ellipse's own frame: u along the axis, v across it.
      const u = dx * axis.x + dy * axis.y;
      const v = -dx * axis.y + dy * axis.x;
      if ((u * u) / a2 + (v * v) / b2 <= 1) region[rowBase + x] = 1;
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

  // Every half-width below is `wu * <per-bone multiple>`, so the global trim is
  // applied in exactly one place and cannot be forgotten on a single capsule.
  // `unit` itself stays the raw shoulder width — it is also the scale for
  // POSITIONS (the head offset), which the thickness dial must not move.
  const wu = unit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE);

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
    if (a && b) stampCapsule(region, width, height, a, b, wu * mult);
  }

  // ── Torso: the shoulders/hips quad, filled and dilated by the edge capsules ──
  const torso = [ls, rs, rh, lh].filter(Boolean) as Pt[];
  if (torso.length === 4) {
    stampPolygonInterior(region, width, height, torso);
    for (let i = 0; i < 4; i++) {
      stampCapsule(region, width, height, torso[i], torso[(i + 1) % 4], wu * W.torso);
    }
  } else if (ls && rs) {
    stampCapsule(region, width, height, ls, rs, wu * W.torso);
  }

  // ── Feet — a disc past each ankle, since the shin capsule stops at the joint ──
  for (const ai of [L_ANKLE, R_ANKLE] as const) {
    const a = J(ai);
    if (a) stampCapsule(region, width, height, a, a, wu * W.foot);
  }

  // ── Head + neck ──────────────────────────────────────────────────────────
  // The neck is the only thing stopping the head from reading as a floating ball,
  // so it has to survive the frames where the head is MOST likely to be orphaned:
  // a fast swing, where motion blur drops one shoulder below MIN_SCORE. The
  // previous version could only anchor to the shoulder MIDPOINT, so it required
  // BOTH shoulders — and on exactly those frames it drew no neck at all while the
  // torso quad (which needs all four of shoulders+hips) was thinning out too,
  // leaving the head zone connected to nothing.
  //
  // Two changes, both confined to this segment:
  //   1. Anchor to the shoulder midpoint when both shoulders are visible, and to
  //      whichever single shoulder IS visible otherwise. One shoulder is a worse
  //      estimate of the neck's base than two, but it is enormously better than
  //      the no-neck-at-all it replaces.
  //   2. Push the far end PAST that anchor and on into the chest, so the neck
  //      merges into the torso slab instead of stopping flush against its top
  //      edge — a butt joint that any small pose error can re-open into a seam.
  //
  // Both only ever ADD zone area, so no frame that is already clean can regress:
  // the zone is a limiter ANDed with the segmenter, never a source of pixels on
  // its own, and the extra area sits inside the chest the segmenter already keeps.
  const nose = J(NOSE);
  if (nose) {
    const neckAnchor: Pt | null = ls && rs
      ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
      : (ls ?? rs);

    // Head: a vertical-ish OVAL, not a disc, with its long axis PERPENDICULAR TO
    // THE SHOULDER LINE.
    //
    // The obvious axis is neck→nose, and that is what this used to do. The nose is
    // a single jittery landmark, though, and the neck anchor is derived from the
    // shoulders anyway — so that axis inherits all of the nose's frame-to-frame
    // noise and swings the oval around with it. The shoulder line is the steadiest
    // direction the pose gives us (two high-confidence joints, a long baseline),
    // and the body's up direction is simply its normal. Same head, far calmer axis.
    //
    // The normal has two directions; the one pointing AWAY from the torso is the
    // one we want. Hips decide that when they are visible (a long, stable
    // reference); the nose decides it otherwise. Both are used only for the SIGN,
    // never for the angle, so nose jitter cannot rotate the oval — at worst it
    // would have to cross the shoulder line to flip it.
    let axis: Pt = { x: 0, y: -1 };
    if (ls && rs) {
      const sx = rs.x - ls.x;
      const sy = rs.y - ls.y;
      const slen = Math.hypot(sx, sy);
      if (slen > Math.max(MIN_SHOULDER_LINE_PX, unit * MIN_SHOULDER_LINE_LENGTH)) {
        // Rotate the shoulder line by -90°.
        let nx = sy / slen;
        let ny = -sx / slen;
        const shouldersMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const hipsMid = lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : null;
        const upRef = hipsMid
          ? { x: shouldersMid.x - hipsMid.x, y: shouldersMid.y - hipsMid.y }
          : { x: nose.x - shouldersMid.x, y: nose.y - shouldersMid.y };
        if (nx * upRef.x + ny * upRef.y < 0) { nx = -nx; ny = -ny; }
        axis = { x: nx, y: ny };
      }
    }
    // The oval RISES FROM THE SHOULDER MIDPOINT: its lower vertex sits on that
    // midpoint (plus an optional lift) and the major axis runs straight up the
    // shoulder line's normal, so the centre is one semi-major further along. The
    // head is therefore anchored to the two steadiest joints in the pose rather
    // than to the nose, which only ever contributed jitter.
    //
    // The nose stays the anchor when there is no shoulder pair to build from —
    // a lone landmark beats no head zone at all.
    const semiMajor = wu * W.head;
    const headLift = (opts.headBaseOffset ?? DEFAULT_HEAD_BASE_OFFSET) * unit;
    const headBase = ls && rs
      ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
      : { x: nose.x - axis.x * semiMajor, y: nose.y - axis.y * semiMajor };
    const headCenter = {
      x: headBase.x + axis.x * (headLift + semiMajor),
      y: headBase.y + axis.y * (headLift + semiMajor),
    };
    stampEllipse(region, width, height, headCenter, axis, semiMajor, wu * W.headWidth);

    if (neckAnchor) {
      const overshoot = opts.neckOvershoot ?? DEFAULT_NECK_OVERSHOOT;
      const chest = {
        x: neckAnchor.x + (neckAnchor.x - nose.x) * overshoot,
        y: neckAnchor.y + (neckAnchor.y - nose.y) * overshoot,
      };
      stampCapsule(region, width, height, nose, chest, wu * W.neck);
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
    stampCapsule(region, width, height, wr, tip, wu * W.implement);
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
  const wu = unit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (p: Pt, pad: number) => {
    if (p.x - pad < minX) minX = p.x - pad;
    if (p.x + pad > maxX) maxX = p.x + pad;
    if (p.y - pad < minY) minY = p.y - pad;
    if (p.y + pad > maxY) maxY = p.y + pad;
  };

  // Widest per-joint pad: whichever capsule touching it is thickest. NOSE is not
  // in this map — the head oval is not centred on it, so it is grown separately
  // below with the centre offset folded in.
  const jointPad: Record<number, number> = {
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
    grow(p, wu * jointPad[idx]);
  }

  // Head: the oval rises from the shoulder midpoint (or the nose, when there is
  // no shoulder pair) in a direction this function does not compute. Padding the
  // anchor by the oval's FULL length covers it whichever way it points — loose by
  // construction, which is what a crop box wants to be.
  const nose = J(NOSE);
  const headAnchor: Pt | null = ls && rs
    ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
    : nose;
  if (headAnchor) {
    any = true;
    const headLift = (opts.headBaseOffset ?? DEFAULT_HEAD_BASE_OFFSET) * unit;
    grow(headAnchor, headLift + wu * Math.max(2 * W.head, W.headWidth));
  }
  if (!any) return null;

  // Implement tips — the reason this function exists rather than using a joint bbox.
  const reach = opts.implementReach ?? DEFAULT_IMPLEMENT_REACH;
  for (const [wi, ei] of [[L_WRIST, L_ELBOW], [R_WRIST, R_ELBOW]] as const) {
    const wr = J(wi), el = J(ei);
    if (!wr || !el) continue;
    grow({ x: wr.x + (wr.x - el.x) * reach, y: wr.y + (wr.y - el.y) * reach }, wu * W.implement);
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
