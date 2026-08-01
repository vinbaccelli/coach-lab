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
const L_EYE = 1, R_EYE = 2;
const L_EAR = 3, R_EAR = 4;
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
  /**
   * EXTRA LATERAL ALLOWANCE ALONG THE THIGH, OUTWARD ONLY — for loose shorts.
   *
   * Every other width here is a band centred ON the bone, which fits skin and a
   * sleeve but not a garment that hangs away from the leg. Loose shorts flare out
   * past the thigh line, so on real footage the segmenter classified the outer
   * shorts edge as `clothes` correctly and the zone's strict AND cut it off — the
   * debug overlay showed that edge CYAN (zone-rejected), not magenta.
   *
   * WHY OUTWARD-ONLY, NOT A BIGGER `thigh`.
   * The hip keypoints sit roughly 0.7 × shoulder width apart, while the thigh
   * half-width is already 0.4 — so the two thigh capsules very nearly meet at the
   * pelvis as it is. Widening them symmetrically would close the gap BETWEEN the
   * legs, which is precisely the region this file's capsule design exists to keep
   * open (see "WHY THIS SHAPE, NOT PROXIMITY"), and precisely where background
   * hides. Shorts flare away from the midline, never into the crotch, so the
   * allowance follows the garment: the outer edge moves out, the inner edge does
   * not move at all.
   *
   * Implemented as a second capsule per thigh, offset outward along the pelvis
   * axis — so lateral reach becomes `thigh + thighFlare` outward and stays
   * `thigh` inward. It only ever ALLOWS: the segmenter still decides what is
   * actually kept inside it, and the bone cores (which PAINT) deliberately do not
   * use this width.
   */
  thighFlare: number;
  /**
   * INWARD (inseam-side) thigh allowance for shorts — the mirror of `thighFlare`,
   * and the dangerous direction, so it is separately named and HARD-CAPPED.
   *
   * Shorts have an inner edge too, and the outward-only flare left it clipped. The
   * inward direction cannot simply be widened, though: past the body's centre it
   * stops being "this leg's shorts" and becomes the gap between the legs, which is
   * where background hides.
   *
   * THE GUARANTEE: the inward capsule is CLIPPED AT THE PELVIS MIDLINE — the line
   * through the hip midpoint normal to the pelvis axis. So this allowance can
   * cover the inseam fabric from the thigh bone up to the body's centre and CANNOT
   * ADD A SINGLE PIXEL past it, whatever the pose or the tuning. Note this caps
   * what the FLARE adds; the base thigh capsule's own reach is untouched, so no
   * frame's existing zone gets narrower.
   *
   * Smaller than `thighFlare` because a garment hangs further out than in.
   */
  thighFlareInner: number;
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
  thighFlare: 0.22,
  thighFlareInner: 0.14,
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

/**
 * The SHAPES the zone was rasterized from, in mask-pixel space.
 *
 * Returned alongside the rasterized region so a diagnostic overlay can outline the
 * head oval and each capsule EXACTLY as the zone was built — rather than
 * re-deriving the geometry in the overlay, which would be free to drift from the
 * real thing and quietly show a lie.
 */
export interface SkeletonZoneShapes {
  /** The head oval. Absent when no head could be placed. */
  head: { center: Pt; axis: Pt; semiMajor: number; semiMinor: number } | null;
  /**
   * Every capsule, as its segment plus half-width. Round caps at both ends.
   * `clip`, when present, is the half-plane the capsule was actually restricted
   * to — the overlay MUST honour it, or it would outline a shape wider than the
   * one the zone was built from and quietly show a lie.
   */
  capsules: Array<{ a: Pt; b: Pt; halfWidth: number; label: string; clip?: HalfPlaneClip }>;
  /** The torso quad, when all four corners were visible. */
  torso: Pt[] | null;
  /** Shoulder width in px — the unit every thickness is a multiple of. */
  unitPx: number;
  /**
   * Which measurement `unitPx` came from. Anything other than 'shoulder' means
   * the floor fired because the shoulder line was implausibly short for this
   * pose — the collapse case that cut the head off.
   */
  unitSource: PoseScaleSource;
  /**
   * The separate, non-foreshortening scale the HEAD OVAL was sized from (see
   * `poseHeadScaleUnit`). Equal to `unitPx` on a normal frontal frame; larger on
   * a side-on frame, which is the whole point.
   */
  headUnitPx: number;
  /** Which measurement `headUnitPx` came from — 'shoulder' means no lift was needed. */
  headUnitSource: HeadScaleSource;
}

export interface SkeletonFilterResult {
  mask: AlphaMask;
  /** False when the filter declined to act (and `mask` is the input, unchanged). */
  applied: boolean;
  keptPx: number;
  droppedPx: number;
  /** Area of the generated player-shape region, in px. */
  shapePx: number;
  /**
   * Pixels the BONE CORES put back that the segmenter had missed — the elbow and
   * leg recovery. Zero means the segmenter already covered every bone, i.e. the
   * union changed nothing on this frame.
   */
  forcedPx: number;
  /** The bone-core alpha, so diagnostics can show exactly what was forced on. */
  coreMask?: AlphaMask | null;
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

/**
 * How short the shoulder line may get, as a fraction of what the rest of the pose
 * says it should be, before it is treated as collapsed rather than as a
 * measurement. 0.5 = "less than half the expected shoulder width".
 *
 * Deliberately loose. A genuine foreshortened shoulder line — the athlete turned
 * side-on to the camera — legitimately measures well under a frontal one, and
 * must NOT be overridden; that is a real pose, and its narrow zone is correct.
 * What this catches is the qualitatively different case where the detector put
 * both shoulder keypoints in nearly the same place while the rest of the body is
 * still spread across a normal area.
 */
const SHOULDER_COLLAPSE_RATIO = 0.5;

/**
 * Rough anthropometric conversions into an EQUIVALENT SHOULDER WIDTH, used only
 * when the measured shoulder line is not trustworthy. They do not need to be
 * accurate — they need to be the right order of magnitude, because the thing they
 * replace is off by ~10x.
 *
 * They lean slightly LARGE on purpose, which is the safe direction here: this
 * file's whole doctrine (see CapsuleWidths) is that over-keeping a little
 * background is a brush stroke, while clipping through the athlete is a visible
 * defect.
 */
const SHOULDER_PER_HIP_WIDTH = 1.1;      // shoulders run a little wider than hips
const SHOULDER_PER_BBOX_DIAGONAL = 0.25; // the long-standing whole-pose fallback

/**
 * WHY TORSO HEIGHT IS NOT ONE OF THESE, THOUGH IT LOOKS LIKE THE OBVIOUS THIRD.
 *
 * It cannot be computed without the hips (it is shoulder-mid → hip-mid), so it is
 * never available in the case a hip fallback would be missing — it can only ever
 * be a second opinion where hip width already exists, never a replacement.
 *
 * And as a second opinion it is actively dangerous, because it is the one measure
 * that does NOT foreshorten with the others. An athlete turned side-on has a
 * genuinely narrow shoulder line AND narrow hips but a full-length torso — which
 * is geometrically indistinguishable from a detector that collapsed both. Letting
 * torso height win would leave the side-on frames (common in a tennis swing)
 * with a zone ~3x too wide, trading a rare failure for a frequent one.
 *
 * Consequence, stated plainly: a pose whose shoulders AND hips both collapse
 * together is NOT caught by this floor. Catching it needs a signal from outside
 * the single frame — see the note on the temporal median in the report.
 */

/** Which measurement `poseScaleUnit` ended up trusting. Reported in diagnostics. */
export type PoseScaleSource = 'shoulder' | 'hip' | 'bbox';

/**
 * THE HEAD IS THE EXCEPTION TO SHOULDER-WIDTH SCALING.
 *
 * Everything else in this file scales with `unit` (shoulder width) and SHOULD:
 * limbs, torso and hips all foreshorten together when the athlete turns side-on,
 * so a narrow zone on a side-on frame is correct. `poseScaleUnit` deliberately
 * leaves that alone (see SHOULDER_COLLAPSE_RATIO) — a real foreshortened pose is
 * a measurement, not a collapse.
 *
 * A HEAD DOES NOT FORESHORTEN. It is roughly a sphere: turn the athlete 90° and
 * its on-screen size barely changes, while the shoulder line can lose a third of
 * its length. Pinning the head oval to `unit` therefore shrinks the head zone on
 * exactly the frames where nothing about the head got smaller — measured on real
 * footage: a prep-stance frame at unit=68px got 80px of head reach where the
 * neighbouring frames at unit=86–102px got 101–120px, and the skull was clipped
 * out of an otherwise good segmentation.
 *
 * So the head (and only the head) is sized from a NON-FORESHORTENING scale: the
 * largest of the shoulder unit and the independent estimates below, converted to
 * an equivalent shoulder width so the existing `W.head` / `W.headWidth`
 * multipliers keep their meaning unchanged.
 *
 * TORSO HEIGHT IS THE PRIMARY ESTIMATE — and note this is the same property that
 * made it WRONG for `poseScaleUnit`. The note above `poseScaleUnit` rejects it
 * precisely because "it is the one measure that does NOT foreshorten with the
 * others", which would inflate a genuinely side-on body. That is a defect for a
 * width and exactly the behaviour a head needs. Same fact, opposite conclusion,
 * because the head is the one part that shares the property.
 *
 * HEAD LANDMARK SPAN IS THE BACKUP, for the case torso height cannot cover: an
 * athlete both side-on AND bent forward, whose torso is foreshortened too. The
 * MAXIMUM pairwise distance across the visible head landmarks is used rather than
 * any single pair, because every individual pair foreshortens on some rotation
 * (ear↔ear collapses side-on, nose↔ear collapses front-on) while the largest of
 * them stays roughly the head's true size through the turn.
 */
const SHOULDER_PER_TORSO_HEIGHT = 0.87;  // shoulder width ≈ 0.87 × shoulder-mid→hip-mid
const SHOULDER_PER_HEAD_SPAN = 2.2;      // conservative: head landmarks span ≈ 0.45 × shoulder width

/**
 * Hard ceiling on the head scale, as a multiple of the shoulder unit.
 *
 * The estimates above are anthropometric approximations riding on detected
 * joints; a mis-detected hip or a spurious ear would otherwise scale the head
 * oval without limit. 1.6 comfortably covers the measured deficit (68px needed
 * ~90px, a 1.32× lift) while making a runaway impossible.
 */
const HEAD_UNIT_MAX_INFLATION = 1.6;

/** Which measurement the HEAD scale ended up using. Reported in diagnostics. */
export type HeadScaleSource = 'shoulder' | 'torso' | 'headSpan';

/**
 * The scale unit for everything that does NOT foreshorten with torso rotation —
 * the HEAD OVAL, the segmenter CROP, and the shorts FLARE (a garment is the same
 * width of cloth whichever way the athlete faces) — in mask pixels. Shoulder
 * width, floored by independent measures that do not foreshorten.
 *
 * Returns `poseScaleUnit`'s answer verbatim on a normal frontal frame (where the
 * estimates agree, so the max changes nothing) and lifts it only when the
 * shoulder line has foreshortened away from the rest of the body.
 *
 * Exported for the same reason `poseScaleUnit` is: the zone and the crop must
 * read one function, or the crop can be smaller than the shape it has to contain.
 */
export function poseHeadScaleUnit(
  keypoints: NormKeypoint[] | null | undefined,
  width: number,
  height: number,
): { unit: number; source: HeadScaleSource } | null {
  const base = poseScaleUnit(keypoints, width, height);
  if (!base || !keypoints) return base ? { unit: base.unit, source: 'shoulder' } : null;

  const J = (i: number) => joint(keypoints, i, width, height);
  let best = { unit: base.unit, source: 'shoulder' as HeadScaleSource };
  const consider = (value: number, source: HeadScaleSource) => {
    if (value > best.unit) best = { unit: value, source };
  };

  // 1. Torso height — shoulder midpoint to hip midpoint.
  const ls = J(L_SHOULDER), rs = J(R_SHOULDER), lh = J(L_HIP), rh = J(R_HIP);
  if (ls && rs && lh && rh) {
    const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    const torsoH = Math.hypot(sm.x - hm.x, sm.y - hm.y);
    if (torsoH >= 1) consider(torsoH * SHOULDER_PER_TORSO_HEIGHT, 'torso');
  }

  // 2. Head landmark span — the largest pairwise distance among nose/eyes/ears.
  const headPts = [NOSE, L_EYE, R_EYE, L_EAR, R_EAR]
    .map((i) => J(i))
    .filter(Boolean) as Pt[];
  let span = 0;
  for (let i = 0; i < headPts.length; i++) {
    for (let j = i + 1; j < headPts.length; j++) {
      const d = Math.hypot(headPts[i].x - headPts[j].x, headPts[i].y - headPts[j].y);
      if (d > span) span = d;
    }
  }
  if (span >= 1) consider(span * SHOULDER_PER_HEAD_SPAN, 'headSpan');

  // Never let an approximation run away from the pose it came from.
  const ceiling = base.unit * HEAD_UNIT_MAX_INFLATION;
  if (best.unit > ceiling) best = { unit: ceiling, source: best.source };
  return best;
}

/**
 * The scale unit for the whole zone, in mask pixels, with a sanity FLOOR.
 *
 * WHY THIS EXISTS. `unit` is the shoulder width, and EVERY capsule half-width,
 * the head oval, and — through `skeletonShapeBounds` — the crop rect handed to
 * the segmenter are multiples of it. The old guard only rejected `unit < 1`,
 * i.e. essentially zero. So a shoulder line that was implausibly short but
 * non-zero (36px measured, against 87–98px on the neighbouring good frames) was
 * accepted verbatim and scaled the entire zone AND the segmenter crop down by
 * roughly 10x. The zone collapsed to 26,080px against an 83,715px person, and
 * the head fell outside it — the head-cutoff frame at t=1.94s.
 *
 * The file already knew a shoulder line under `MIN_SHOULDER_LINE_PX` is
 * untrustworthy — but only applied that to the head's ORIENTATION (line ~436).
 * The same distrust belongs on the SCALE, which is what this adds.
 *
 * THE RULE. Take the most reliable independent measure available, converted to an
 * equivalent shoulder width, in this order of trust:
 *   1. hip width      — anatomically stable, usually well detected, and it
 *                       foreshortens WITH the shoulders, so a side-on athlete is
 *                       left alone instead of being inflated
 *   2. bbox diagonal  — last resort; inflated by an extended arm or racket, which
 *                       is why it ranks last
 * (Torso height was considered and deliberately rejected — see the note above.)
 * If the measured shoulder line is at least `SHOULDER_COLLAPSE_RATIO` of that
 * reference, it is believed. Otherwise the reference is used instead.
 *
 * Purely RELATIVE — every comparison is against other measures of the SAME pose.
 * An athlete genuinely small in frame scales all of these down together and is
 * left alone; only internal disagreement triggers the floor.
 *
 * Exported so the zone and the crop cannot drift apart: both read this.
 */
export function poseScaleUnit(
  keypoints: NormKeypoint[] | null | undefined,
  width: number,
  height: number,
): { unit: number; source: PoseScaleSource } | null {
  if (!keypoints || keypoints.length < 17 || width < 1 || height < 1) return null;
  const J = (i: number) => joint(keypoints, i, width, height);
  const ls = J(L_SHOULDER), rs = J(R_SHOULDER);
  const lh = J(L_HIP), rh = J(R_HIP);

  const shoulderW = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : 0;

  // ── Independent references, best first ─────────────────────────────────────
  const refs: Array<{ value: number; source: PoseScaleSource }> = [];

  if (lh && rh) {
    const hipW = Math.hypot(lh.x - rh.x, lh.y - rh.y);
    if (hipW >= 1) refs.push({ value: hipW * SHOULDER_PER_HIP_WIDTH, source: 'hip' });
  }

  const vis = keypoints.filter((k) => k && k.score >= MIN_SCORE);
  if (vis.length >= 3) {
    const xs = vis.map((k) => k.x * width);
    const ys = vis.map((k) => k.y * height);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (diag >= 1) refs.push({ value: diag * SHOULDER_PER_BBOX_DIAGONAL, source: 'bbox' });
  }

  const reference = refs[0] ?? null;

  // Believe the shoulder line unless the rest of the pose contradicts it.
  if (shoulderW >= 1 && (!reference || shoulderW >= reference.value * SHOULDER_COLLAPSE_RATIO)) {
    return { unit: shoulderW, source: 'shoulder' };
  }
  if (reference && reference.value >= 1) {
    return { unit: reference.value, source: reference.source };
  }
  // Nothing usable at all (and no believable shoulder line either).
  return shoulderW >= 1 ? { unit: shoulderW, source: 'shoulder' } : null;
}

/** Visible joint in mask-pixel space, or null. */
function joint(kps: NormKeypoint[], idx: number, w: number, h: number, minScore = MIN_SCORE): Pt | null {
  const k = kps[idx];
  if (!k || k.score < minScore) return null;
  return { x: k.x * w, y: k.y * h };
}

// ─────────────────────────────────────────────────────────────────────────────
// BONE CORES — the skeleton as POSITIVE evidence, not just as a limit.
//
// The zone answers "may this pixel survive?". It cannot answer "must it?", and
// that asymmetry is a real defect: when the segmenter finds no person at a limb,
// `segmentation ∩ zone` drops the limb even though a tracked bone runs straight
// through it. On real frames that removed an elbow and a whole leg while the
// skeleton tracked both perfectly.
//
// A detected bone between two confident joints is strong evidence that those
// pixels ARE the athlete — stronger, at that spot, than a 256px segmentation that
// returned nothing. So a thin capsule along each bone is unioned back in.
//
// THICKNESS IS THE WHOLE SAFETY ARGUMENT. The core is a fraction of the ZONE
// width, not the zone width itself. The zone is deliberately generous (it must
// not clip the athlete), so it is wider than the real limb and its gaps between
// limbs are exactly where background hides. A core at ~45% of that sits inside
// the limb's own silhouette, so forcing it solid cannot reach the gap between the
// arm and the torso — which is what would happen if the full zone were forced.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confidence required at BOTH ends of a bone before it may force pixels ON.
 *
 * Higher than `MIN_SCORE` on purpose. Drawing a limit around a shaky joint is
 * cheap — the segmenter still decides what survives inside it. PAINTING pixels
 * from a shaky joint is not: a hallucinated limb becomes a solid bar of fake
 * athlete that no later stage can undo. Forcing pixels on demands better evidence
 * than merely allowing them.
 */
const MIN_CORE_SCORE = 0.35;

/**
 * Core half-width as a fraction of the same bone's ZONE half-width. Tracks the
 * zone's tuning (including `thicknessScale`) rather than being a second set of
 * constants that can drift away from it.
 */
const CORE_WIDTH_FRACTION = 0.45;

/**
 * Outer fraction of the core that ramps to zero instead of ending square.
 *
 * Without it a recovered limb would meet the segmenter's feathered edge with a
 * hard-edged stripe, which reads as a seam in the composite. The soft-alpha
 * contract is about the whole mask staying feathered, so the patch has to be
 * feathered too.
 */
const CORE_FEATHER = 0.35;

/**
 * Stamp a capsule as SOFT alpha: solid in the middle, ramping to 0 at the edge.
 * Writes max(existing, value), so overlapping bones never darken each other.
 */
function stampCapsuleAlpha(
  buf: Uint8ClampedArray, w: number, h: number, a: Pt, b: Pt, halfWidth: number, feather: number,
): void {
  if (halfWidth <= 0) return;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - halfWidth));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + halfWidth));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - halfWidth));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + halfWidth));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const inner = halfWidth * (1 - Math.max(0, Math.min(1, feather)));

  for (let y = y0; y <= y1; y++) {
    const rowBase = y * w;
    for (let x = x0; x <= x1; x++) {
      const px = x - a.x;
      const py = y - a.y;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0;
      const cx = px - t * dx;
      const cy = py - t * dy;
      const d = Math.hypot(cx, cy);
      if (d > halfWidth) continue;
      const v = d <= inner
        ? 255
        : Math.round(255 * (1 - (d - inner) / Math.max(1e-6, halfWidth - inner)));
      const i = rowBase + x;
      if (v > buf[i]) buf[i] = v;
    }
  }
}

/**
 * Soft-alpha map of the bones that are confident enough to force pixels ON.
 *
 * DELIBERATELY EXCLUDED:
 *   - the IMPLEMENT capsule (wrist → extrapolated tip). That tip is a guess
 *     derived from forearm direction, not a detection. Forcing it solid would
 *     paint a racket-shaped bar of "athlete" wherever the arm points, including
 *     into open background on any frame where the racket is elsewhere.
 *   - the HEAD oval. Its centre is derived from the shoulder midpoint and an
 *     orientation this file already distrusts on short shoulder lines, so it is
 *     the least reliable shape to paint from. Head coverage is a ZONE-sizing
 *     question and was addressed by the scale floor in `poseScaleUnit`.
 * Both remain in the zone; they are simply not treated as ground truth.
 */
export function buildBoneCoreAlpha(
  keypoints: NormKeypoint[] | null | undefined,
  width: number,
  height: number,
  opts: SkeletonShapeOptions = {},
): { core: Uint8ClampedArray; corePx: number } | null {
  if (!keypoints || keypoints.length < 17 || width < 1 || height < 1) return null;
  const scale = poseScaleUnit(keypoints, width, height);
  if (!scale) return null;

  const W = { ...DEFAULT_CAPSULE_WIDTHS, ...(opts.widths ?? {}) };
  const wu = scale.unit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE) * CORE_WIDTH_FRACTION;
  // Only joints good enough to paint from.
  const J = (i: number) => joint(keypoints, i, width, height, MIN_CORE_SCORE);

  const core = new Uint8ClampedArray(width * height);
  let stamped = false;

  const bones: Array<[number, number, number]> = [
    [L_SHOULDER, L_ELBOW, W.upperArm], [L_ELBOW, L_WRIST, W.forearm],
    [R_SHOULDER, R_ELBOW, W.upperArm], [R_ELBOW, R_WRIST, W.forearm],
    [L_HIP, L_KNEE, W.thigh], [L_KNEE, L_ANKLE, W.shin],
    [R_HIP, R_KNEE, W.thigh], [R_KNEE, R_ANKLE, W.shin],
  ];
  for (const [ia, ib, mult] of bones) {
    const a = J(ia), b = J(ib);
    if (!a || !b) continue;
    stampCapsuleAlpha(core, width, height, a, b, wu * mult, CORE_FEATHER);
    stamped = true;
  }

  // Torso: the SPINE line only (shoulder midpoint → hip midpoint), not the quad.
  // A band down the middle of the trunk is unambiguously body; filling the whole
  // quad would be a large solid region resting on four joints at once, which is a
  // lot of painted pixels riding on one bad frame.
  const ls = J(L_SHOULDER), rs = J(R_SHOULDER), lh = J(L_HIP), rh = J(R_HIP);
  if (ls && rs && lh && rh) {
    stampCapsuleAlpha(
      core, width, height,
      { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 },
      { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 },
      wu * W.torso, CORE_FEATHER,
    );
    stamped = true;
  }

  if (!stamped) return null;
  let corePx = 0;
  for (let i = 0; i < core.length; i++) if (core[i] > 0) corePx++;
  return { core, corePx };
}

/**
 * A half-plane restriction on a stamped shape: only pixels `p` satisfying
 * `dot(p - origin, normal) >= 0` may be marked. Used to cap the inward shorts
 * flare at the pelvis midline, so widening toward the body's centre can never
 * spill past it into the other leg's background.
 */
export interface HalfPlaneClip {
  origin: Pt;
  /** Points toward the ALLOWED side. Need not be unit length. */
  normal: Pt;
}

function allowedByClip(clip: HalfPlaneClip | undefined, x: number, y: number): boolean {
  if (!clip) return true;
  return (x - clip.origin.x) * clip.normal.x + (y - clip.origin.y) * clip.normal.y >= 0;
}

/** Mark every pixel within `halfWidth` of segment a→b. Iterates the segment's
 *  bounding box only, so cost is proportional to the capsule, not the frame.
 *  `clip`, when given, additionally restricts it to one side of a line. */
function stampCapsule(
  region: Uint8Array, w: number, h: number, a: Pt, b: Pt, halfWidth: number,
  clip?: HalfPlaneClip,
): void {
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
      if (cx * cx + cy * cy <= r2 && allowedByClip(clip, x, y)) region[rowBase + x] = 1;
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
): { region: Uint8Array; shapePx: number; shapes: SkeletonZoneShapes } | null {
  if (!keypoints || keypoints.length < 17 || width < 1 || height < 1) return null;

  const W = { ...DEFAULT_CAPSULE_WIDTHS, ...(opts.widths ?? {}) };
  const J = (i: number) => joint(keypoints, i, width, height);

  const ls = J(L_SHOULDER), rs = J(R_SHOULDER);
  const lh = J(L_HIP), rh = J(R_HIP);

  // Shoulder width is the scale unit for every capsule — floored against the rest
  // of the pose so a collapsed shoulder detection cannot shrink the whole zone.
  // See poseScaleUnit; the crop in skeletonShapeBounds reads the same helper, so
  // the zone and the segmenter's input can never disagree about the body's size.
  const scale = poseScaleUnit(keypoints, width, height);
  if (!scale) return null;
  const unit = scale.unit;

  // Every half-width below is `wu * <per-bone multiple>`, so the global trim is
  // applied in exactly one place and cannot be forgotten on a single capsule.
  // `unit` itself stays the raw shoulder width — it is also the scale for
  // POSITIONS (the head offset), which the thickness dial must not move.
  const wu = unit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE);

  // The HEAD's own scale — shoulder width floored by measures that do not
  // foreshorten. Used for the head oval ONLY; every other capsule below stays on
  // `unit`, because those parts genuinely do foreshorten with the shoulders.
  const headScale = poseHeadScaleUnit(keypoints, width, height) ?? { unit, source: 'shoulder' as HeadScaleSource };
  const headUnit = headScale.unit;

  const region = new Uint8Array(width * height);
  // Recorded as the zone is built, so the overlay outlines the SAME shapes.
  const shapes: SkeletonZoneShapes = {
    head: null, capsules: [], torso: null, unitPx: unit, unitSource: scale.source,
    headUnitPx: headUnit, headUnitSource: headScale.source,
  };

  // ── Limbs ────────────────────────────────────────────────────────────────
  const limbs: Array<[number, number, number]> = [
    [L_SHOULDER, L_ELBOW, W.upperArm], [L_ELBOW, L_WRIST, W.forearm],
    [R_SHOULDER, R_ELBOW, W.upperArm], [R_ELBOW, R_WRIST, W.forearm],
    [L_HIP, L_KNEE, W.thigh], [L_KNEE, L_ANKLE, W.shin],
    [R_HIP, R_KNEE, W.thigh], [R_KNEE, R_ANKLE, W.shin],
  ];
  const LIMB_LABELS = ['L upper arm', 'L forearm', 'R upper arm', 'R forearm', 'L thigh', 'L shin', 'R thigh', 'R shin'];
  limbs.forEach(([ia, ib, mult], li) => {
    const a = J(ia), b = J(ib);
    if (a && b) {
      stampCapsule(region, width, height, a, b, wu * mult);
      shapes.capsules.push({ a, b, halfWidth: wu * mult, label: LIMB_LABELS[li] ?? 'limb' });
    }
  });

  // ── Shorts flare: extra OUTWARD allowance along each thigh ────────────────
  //
  // A second thigh capsule, shifted away from the body's midline along the pelvis
  // axis. Union with the capsule already stamped above gives lateral reach of
  // `thigh + thighFlare` on the outside and an unchanged `thigh` on the inside,
  // so the gap between the legs is exactly as open as it was.
  //
  // The pelvis axis (hip→hip) is the direction, not the shoulder line: the legs
  // follow the pelvis, and on a rotated torso the two disagree. Both hips are
  // required — with one hip there is no midline to be "outward" from, and a
  // guessed direction could push the allowance the wrong way, so the flare is
  // simply skipped and the zone falls back to its previous behaviour.
  // A GARMENT DOES NOT FORESHORTEN, so the flare is sized from `headUnit` (the
  // non-foreshortening scale) rather than `unit`. Shorts are the same width of
  // cloth whichever way the athlete is facing; sizing the allowance from the
  // shoulder line gave a side-on frame ~30% less flare in PIXELS than a frontal
  // one for the identical garment, which is why some external shorts edge
  // survived the first version of this fix on the narrow-unit frames. Same
  // reasoning as the head oval, applied to clothing.
  //
  // The offset capsules keep the BASE thigh half-width (`wu`, unit-based), so the
  // flare adds exactly `garmentWu × flare` px beyond the existing capsule and
  // nothing else about the leg zone changes.
  if (lh && rh && (W.thighFlare > 0 || W.thighFlareInner > 0)) {
    const hx = lh.x - rh.x;
    const hy = lh.y - rh.y;
    const hlen = Math.hypot(hx, hy);
    if (hlen > MIN_SHOULDER_LINE_PX) {
      const garmentWu = headUnit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE);
      const outFlare = garmentWu * W.thighFlare;
      const inFlare = garmentWu * W.thighFlareInner;
      const halfWidth = wu * W.thigh;
      const ux = hx / hlen;
      const uy = hy / hlen;
      // The pelvis midline: through the hip midpoint, normal to the pelvis axis.
      const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

      const legs: Array<[Pt, number, number, string]> = [
        [lh, L_KNEE, 1, 'L'],
        [rh, R_KNEE, -1, 'R'],
      ];
      for (const [hip, kneeIdx, sign, side] of legs) {
        const knee = J(kneeIdx);
        if (!knee) continue;
        // Unit vector pointing AWAY from the midline, for this leg.
        const outX = ux * sign;
        const outY = uy * sign;

        // Outward — shorts hanging away from the leg. No clip needed: it moves
        // away from the body's centre and cannot approach the other leg.
        if (outFlare > 0) {
          const a = { x: hip.x + outX * outFlare, y: hip.y + outY * outFlare };
          const b = { x: knee.x + outX * outFlare, y: knee.y + outY * outFlare };
          stampCapsule(region, width, height, a, b, halfWidth);
          shapes.capsules.push({ a, b, halfWidth, label: `${side} thigh flare (out)` });
        }

        // Inward — the inseam edge. CLIPPED at the pelvis midline: allowed only
        // on this leg's own side of the body's centre. That cap is what makes
        // widening in the risky direction safe regardless of stance, and it is a
        // geometric guarantee rather than a tuning choice.
        if (inFlare > 0) {
          const a = { x: hip.x - outX * inFlare, y: hip.y - outY * inFlare };
          const b = { x: knee.x - outX * inFlare, y: knee.y - outY * inFlare };
          const clip: HalfPlaneClip = { origin: hipMid, normal: { x: outX, y: outY } };
          stampCapsule(region, width, height, a, b, halfWidth, clip);
          shapes.capsules.push({ a, b, halfWidth, label: `${side} thigh flare (in, midline-capped)`, clip });
        }
      }
    }
  }

  // ── Torso: the shoulders/hips quad, filled and dilated by the edge capsules ──
  const torso = [ls, rs, rh, lh].filter(Boolean) as Pt[];
  if (torso.length === 4) {
    stampPolygonInterior(region, width, height, torso);
    shapes.torso = torso;
    for (let i = 0; i < 4; i++) {
      stampCapsule(region, width, height, torso[i], torso[(i + 1) % 4], wu * W.torso);
      shapes.capsules.push({ a: torso[i], b: torso[(i + 1) % 4], halfWidth: wu * W.torso, label: 'torso edge' });
    }
  } else if (ls && rs) {
    stampCapsule(region, width, height, ls, rs, wu * W.torso);
    shapes.capsules.push({ a: ls, b: rs, halfWidth: wu * W.torso, label: 'shoulders' });
  }

  // ── Feet — a disc past each ankle, since the shin capsule stops at the joint ──
  for (const ai of [L_ANKLE, R_ANKLE] as const) {
    const a = J(ai);
    if (a) {
      stampCapsule(region, width, height, a, a, wu * W.foot);
      shapes.capsules.push({ a, b: a, halfWidth: wu * W.foot, label: 'foot disc' });
    }
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
    // Sized from `headUnit`, NOT `unit` — the head is the one part of the body
    // that does not foreshorten, so it must not shrink with the shoulder line.
    // The oval's BASE stays on the shoulder midpoint and only its far vertex
    // moves, so a larger semiMajor grows the zone UPWARD over the skull and never
    // downward into the chest.
    const headWu = headUnit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE);
    const semiMajor = headWu * W.head;
    const headLift = (opts.headBaseOffset ?? DEFAULT_HEAD_BASE_OFFSET) * unit;
    const headBase = ls && rs
      ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
      : { x: nose.x - axis.x * semiMajor, y: nose.y - axis.y * semiMajor };
    const headCenter = {
      x: headBase.x + axis.x * (headLift + semiMajor),
      y: headBase.y + axis.y * (headLift + semiMajor),
    };
    const semiMinor = headWu * W.headWidth;
    stampEllipse(region, width, height, headCenter, axis, semiMajor, semiMinor);
    shapes.head = { center: headCenter, axis, semiMajor, semiMinor };

    if (neckAnchor) {
      const overshoot = opts.neckOvershoot ?? DEFAULT_NECK_OVERSHOOT;
      const chest = {
        x: neckAnchor.x + (neckAnchor.x - nose.x) * overshoot,
        y: neckAnchor.y + (neckAnchor.y - nose.y) * overshoot,
      };
      stampCapsule(region, width, height, nose, chest, wu * W.neck);
      shapes.capsules.push({ a: nose, b: chest, halfWidth: wu * W.neck, label: 'neck' });
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
    shapes.capsules.push({ a: wr, b: tip, halfWidth: wu * W.implement, label: 'implement' });
  }

  let shapePx = 0;
  for (let i = 0; i < region.length; i++) if (region[i]) shapePx++;
  if (shapePx === 0) return null;

  return { region, shapePx, shapes };
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

  const ls = J(L_SHOULDER), rs = J(R_SHOULDER);
  // SAME floored unit the zone uses — this function sizes the segmenter's crop,
  // and a crop that shrank with a collapsed shoulder line meant the model never
  // saw the head at all, so no amount of zone tuning could put it back.
  const scale = poseScaleUnit(keypoints, width, height);
  if (!scale) return null;
  const unit = scale.unit;

  // THE CROP USES THE NON-FORESHORTENING SCALE, not the raw shoulder unit.
  //
  // The zone can afford to be tight on a side-on frame — a limb it clips was at
  // least SEEN, and the bone-core union can put a tracked one back. The crop
  // cannot: it decides what the segmenter is shown at all, and a limb outside it
  // does not exist as far as the model is concerned. On the measured prep-stance
  // frame (unit=68px against 86–102px on its neighbours) the crop was the
  // tightest of the pass and an arm fell out of it.
  //
  // A limb's on-screen WIDTH does not shrink just because the shoulder line
  // foreshortened, so the pad that has to cover it should not either. Same
  // reasoning as the head, applied to the crop: take the larger scale, which is a
  // no-op on a normal frontal frame.
  const headScale = poseHeadScaleUnit(keypoints, width, height);
  const cropUnit = Math.max(unit, headScale?.unit ?? unit);
  const wu = cropUnit * (opts.thicknessScale ?? DEFAULT_ZONE_THICKNESS_SCALE);

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
    // Hips and knees carry the shorts flare too — the crop has to contain the
    // widened zone, or the segmenter is never shown the outer shorts edge the
    // zone was just widened to admit.
    [L_HIP]: Math.max(W.thigh + W.thighFlare, W.torso), [R_HIP]: Math.max(W.thigh + W.thighFlare, W.torso),
    [L_KNEE]: W.thigh + W.thighFlare, [R_KNEE]: W.thigh + W.thighFlare,
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
    // `wu` already carries the head/crop scale, so this pad grows with the oval
    // it has to contain — the zone and the crop cannot disagree about the head.
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
    mask, applied: false, keptPx: 0, droppedPx: 0, shapePx: 0, forcedPx: 0, coreMask: null,
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

  // ── THEN UNION THE BONE CORES ────────────────────────────────────────────
  //
  // The AND above is a veto the segmenter cannot overrule. This is the opposite
  // and equally necessary statement: where a confidently-tracked bone runs, the
  // athlete IS there, and a segmenter that returned nothing at that spot is
  // wrong rather than authoritative. Without this, a missed elbow or leg is
  // silently deleted from a frame whose skeleton tracked it perfectly.
  //
  // GATED BY `region` — so the hard limit still holds literally. The cores are
  // built from the same bone segments at a fraction of the width and are
  // therefore inside the zone by construction; ANDing anyway means the
  // invariant "nothing outside the zone survives" needs no geometric argument
  // to stay true, and cannot be broken by a future change to either width.
  //
  // max(), not overwrite: where the segmenter already found the limb its own
  // (usually softer, better-fitting) alpha is kept, and the core only fills
  // what was missing.
  const cores = buildBoneCoreAlpha(keypoints, width, height, opts);
  let forcedPx = 0;
  if (cores) {
    const { core } = cores;
    for (let i = 0; i < out.length; i++) {
      const c = core[i];
      if (c <= 0 || !region[i]) continue;
      if (c > out[i]) {
        if (out[i] === 0) forcedPx++;
        out[i] = c;
      }
    }
  }

  return {
    mask: { width, height, data: out },
    applied: true,
    keptPx,
    droppedPx,
    shapePx,
    forcedPx,
    coreMask: cores ? { width, height, data: cores.core } : null,
  };
}
