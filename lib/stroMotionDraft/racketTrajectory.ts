'use client';

import {
  buildSkeletonShapeRegion,
  poseScaleUnit,
  type NormKeypoint,
} from '@/lib/stroMotionDraft/skeletonMaskFilter';

/**
 * RACKET TRAJECTORY — Stages 1 and 2. AXIS ONLY. THIS FILE PAINTS NOTHING.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT racketCandidate.ts
 * The motion-diff detector in racketCandidate.ts fired on real footage and caught
 * the ARM. That was not a tuning failure, it was structural: its EVIDENCE and its
 * CONTAINMENT were the same measurement — "motion connected to the hand" — and
 * during a swing the arm and the racket are one connected motion blur, so the arm
 * satisfies both. No threshold fixes a gate that is defined to include the thing
 * it must exclude.
 *
 * The rotation suspicion was measured and cleared: plate and frame are produced by
 * the same normalizing capture function, so the diff subtracts aligned pixels.
 * COCO-SSD was measured on real swing footage and is dead — 6.7% hit rate, below
 * its own production threshold, firing on the blurred frames rather than the sharp
 * ones, and 607px from the wrist. So there is no per-frame detector to anchor to.
 *
 * WHAT REPLACES IT
 * Separate evidence from containment, and get containment from the BATCH:
 *
 *   STAGE 1 (per frame) returns a DIRECTION, never a blob. At each wrist we sweep
 *   a ray through every angle and score it by the motion energy along it, counting
 *   only samples OUTSIDE the player's own rasterized body shape. A frame where
 *   only the arm moved puts its peak inside the excluded region and therefore
 *   produces no peak at all. It fails CLOSED — the exact inversion of the
 *   connectivity-to-hand gate, which failed open toward the arm.
 *
 *   STAGE 2 (per batch) fits those directions over time. A racket cannot teleport:
 *   θ is smooth in t. Confident frames become knots, a low-order model is fitted
 *   by RANSAC on WRAPPED residuals, and the model is then evaluated on EVERY
 *   frame — including the blurred ones where Stage 1 found nothing. That is the
 *   trajectory rectification, and it is the only part of the design that can put
 *   an axis on a frame whose own pixels are unreadable.
 *
 * BOTH WRISTS, DECIDED BY THE BATCH. Picking the racket hand per frame by score
 * flips hands on real footage (measured at 37%). So Stage 1 sweeps both wrists and
 * Stage 2 fits BOTH hypotheses independently, then keeps whichever produced more
 * inliers at lower residual. The hand is a property of the swing, so it is decided
 * once with every frame's evidence rather than fifteen times with one frame's.
 *
 * THE DOCTRINE IS UNCHANGED: NO RACKET BEATS A WRONG RACKET. Every gate below
 * fails closed, and the batch-level gate refuses the WHOLE batch rather than
 * emitting a shaky axis on some of it.
 *
 * ANGLE CONVENTION: radians, `Math.atan2(dy, dx)` in image space, so y is DOWN.
 * 0 = screen right, +π/2 = screen DOWN. Logged in degrees under that convention.
 */

// ── Stage 1 tuning ──────────────────────────────────────────────────────────
/** Angular resolution of the sweep. 3° → 120 bins. */
const SWEEP_STEP_DEG = 3;
const SWEEP_BINS = Math.round(360 / SWEEP_STEP_DEG);
/** Ray extent, as multiples of the forearm length. */
const R_MIN_FOREARM = 0.35;
const R_MAX_FOREARM = 2.5;
/** Samples taken along each ray between r_min and r_max. */
const RAY_SAMPLES = 28;
/** A ray needs this fraction of its samples usable (in frame, outside the body). */
const RAY_MIN_USABLE = 0.45;
/** Processing resolution cap for the diff patch, matching racketCandidate.ts. */
const WORK_MAX_EDGE = 420;
/** Diff thresholds — deliberately the same numbers as racketCandidate.ts. */
const T_LOW = 30;
const T_HIGH = 70;
/** A peak must stand this many times above the profile's median to be a knot. */
const CONF_MIN = 1.8;
/** …and carry at least this much absolute motion (0-255), so a flat, dead
 *  profile cannot produce a huge ratio out of two grains of noise. */
const PEAK_ENERGY_MIN = 40;

// ── Stage 2 tuning ──────────────────────────────────────────────────────────
/**
 * DEGREES OF FREEDOM, NOT JUST AGREEMENT — the gate this file got wrong once.
 *
 * A quadratic has THREE free parameters, so any three points fit it EXACTLY and
 * report a zero residual. A 3-point consensus is therefore not evidence of
 * anything, and a residual computed over it is not a test. Measured: fifteen
 * uniformly random directions were ACCEPTED with a 0.00° residual off a 3-point
 * "consensus" — precisely the confident-but-wrong axis this whole design exists
 * to prevent.
 *
 * So acceptance needs BOTH:
 *   - enough inliers that the residual has degrees of freedom to be a real test,
 *     with the model order stepped DOWN to a line when there are too few points
 *     to afford a curve, and
 *   - enough of the confident frames AGREEING that chance cannot supply them.
 * With 15 knots and an 18° tolerance, chance yields ~1.4 inliers; the fraction
 * gate asks for 8. That gap is the safety margin.
 */
const MIN_KNOTS = 5;
/** Absolute inlier floor. 5 inliers give a line 3 dof and a quadratic 2. */
const MIN_INLIERS = 5;
/** Below this many inliers a LINE is fitted instead of a quadratic. */
const QUADRATIC_MIN_INLIERS = 7;
/**
 * Inliers must be at least this share of the confident knots.
 *
 * 0.7, not 0.5, and the reason is the hypothesis count. RANSAC over 3-subsets of
 * 15 knots tries 455 models, and each already owns 3 inliers by construction; the
 * best of 455 draws from Binomial(12, 0.1) reaches 5 extra often enough that a
 * half-agreement bar is cleared by chance routinely — measured, on uniformly
 * random directions. Requiring 11 of 15 puts the same event at roughly 1e-6 per
 * hypothesis. If a real sweep is working, the frames confident enough to be knots
 * are the frames that saw the racket, and they should agree far above 70%.
 */
const MIN_INLIER_FRACTION = 0.7;
/**
 * Total unwrapped travel the model may claim across the whole batch.
 *
 * The per-step cap alone bounds speed, not distance: at 150°/frame over 15 frames
 * a model may still wind through nearly six turns, revisiting every direction six
 * times and so passing near almost any random point. A swing captured in one
 * snapshot batch does not wind through more than about two turns, and past that
 * the model is describing aliasing rather than motion.
 */
const MAX_TOTAL_TRAVEL_DEG = 720;
/**
 * THE RATE LIMIT — the file's own premise, finally enforced.
 *
 * "A racket cannot teleport" is the assumption the whole batch fit rests on, but
 * asserting smoothness is not the same as BOUNDING it. Residuals are compared
 * modulo a full turn, so a steep quadratic sweeping through several turns between
 * samples can pass within tolerance of almost any direction — it explains random
 * data by spinning fast enough to alias onto it. Measured: fifteen uniformly
 * random directions still cleared both the inlier count and the agreement
 * fraction, because the winning model was a curve rotating absurdly quickly.
 *
 * Beyond about half a turn between consecutive frames the direction is aliased
 * and genuinely unrecoverable, so a model that needs to move faster than this is
 * not a racket we can claim to know. Capping the per-frame change removes the
 * degeneracy and is the physical statement the design intended all along.
 */
const MAX_STEP_DEG = 150;
/** A frame is an inlier when its wrapped residual is within this. */
const RESID_INLIER_DEG = 18;
/** The fit is refused outright above this RMS residual over the inliers. */
const RESID_MAX_RMS_DEG = 14;
/** Fitted length is clamped to this range, in forearm lengths. */
const LEN_MIN_FOREARM = 0.5;
const LEN_MAX_FOREARM = 3.0;

export type RacketArcSource = 'swept' | 'fitted' | 'rejected';
export type RacketHand = 'left' | 'right';

/** One wrist's angular result on one frame. */
export interface RacketSweepPeak {
  /** Direction of maximum off-body motion energy, radians (image space, y down). */
  theta: number;
  /** peak / median of the angular profile. 1 ≈ flat, i.e. no direction at all. */
  confidence: number;
  /** Mean alpha along the winning ray, 0-255. */
  peakEnergy: number;
  /** How far the energy persists along that ray, in px — the apparent racket length. */
  reachPx: number;
}

/** Everything Stage 1 measured on one frame. */
export interface RacketFrameSweep {
  frameIndex: number;
  timeSec: number;
  left: RacketSweepPeak | null;
  right: RacketSweepPeak | null;
  /** Full angular profiles (SWEEP_BINS entries, mean alpha per bin) for the polar plot. */
  profileLeft: number[] | null;
  profileRight: number[] | null;
  wristLeft: { x: number; y: number } | null;
  wristRight: { x: number; y: number } | null;
  forearmLeftPx: number;
  forearmRightPx: number;
  reason: string;
}

/** The resolved axis for one frame — what the overlay draws. */
export interface RacketAxis {
  frameIndex: number;
  timeSec: number;
  /** Wrist position, full-frame px. */
  origin: { x: number; y: number };
  theta: number;
  lengthPx: number;
  source: RacketArcSource;
  /** Stage 1 confidence on this frame (0 when the frame contributed nothing). */
  confidence: number;
  /** The angular profile for this frame's chosen hand, for the polar plot. */
  profile: number[] | null;
  /** Radius the profile was swept over, px — the polar plot's outer ring. */
  profileRadiusPx: number;
}

export interface RacketTrajectory {
  accepted: boolean;
  hand: RacketHand | null;
  /** One entry per input frame, in input order. Empty when `accepted` is false. */
  axes: RacketAxis[];
  knots: number;
  residualRmsDeg: number;
  reason: string;
}

// ── Toggle ──────────────────────────────────────────────────────────────────

export type RacketMode = 'off' | 'blob' | 'arc';

/**
 * THREE-STATE racket switch, replacing the old boolean.
 *
 *   localStorage.setItem('stroRacket', 'arc')    // trajectory axis, MASKS NOTHING
 *   localStorage.setItem('stroRacket', 'blob')   // the original motion-diff detector
 *   localStorage.removeItem('stroRacket')        // off (default)
 *
 * 'on' / 'true' / '1' still mean 'blob', so any existing switch keeps its exact
 * current meaning and nothing that was already turned on changes behaviour.
 *
 * localStorage is checked for the same reason the segmenter switch checks it: a
 * `window` global set from devtools can land in an isolated world the app never
 * sees (segmenterCommon.ts).
 */
export function racketMode(): RacketMode {
  if (typeof window === 'undefined') return 'off';
  const norm = (v: unknown): RacketMode | null => {
    if (v === true) return 'blob';
    if (v === false) return 'off';
    if (typeof v !== 'string') return null;
    const s = v.toLowerCase();
    if (s === 'arc') return 'arc';
    if (s === 'blob' || s === 'on' || s === 'true' || s === '1') return 'blob';
    if (s === 'off' || s === 'false' || s === '0') return 'off';
    return null;
  };
  const w = window as unknown as Record<string, unknown>;
  const fromWindow = norm(w.__stroRacket);
  if (fromWindow) return fromWindow;
  try {
    return norm(window.localStorage?.getItem('stroRacket')) ?? 'off';
  } catch {
    return 'off';
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

const DEG = 180 / Math.PI;

/** Shortest signed angular difference a−b, wrapped to (−π, π]. */
function angDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── STAGE 1 — the angular sweep ─────────────────────────────────────────────

/**
 * Sweep both wrists on ONE frame and return the angular profiles and their peaks.
 *
 * Returns every field null with a `reason` for each uncertain case — no plate, no
 * pose, no scale, wrist off-frame. A frame that returns nothing is not a failure;
 * Stage 2 is designed to rectify it from its neighbours.
 */
export async function sweepRacketFrame(input: {
  sourceFrame: ImageBitmap;
  background: { bitmap: ImageBitmap; scale: number } | null | undefined;
  keypoints: NormKeypoint[] | null | undefined;
  vw: number;
  vh: number;
  frameIndex: number;
  timeSec: number;
}): Promise<RacketFrameSweep> {
  const { sourceFrame, background, keypoints, vw, vh, frameIndex, timeSec } = input;

  const empty = (reason: string): RacketFrameSweep => ({
    frameIndex, timeSec, left: null, right: null,
    profileLeft: null, profileRight: null,
    wristLeft: null, wristRight: null,
    forearmLeftPx: 0, forearmRightPx: 0, reason,
  });

  // Motion-diff has no meaning without a static-camera plate.
  if (!background) return empty('no background plate');
  if (!keypoints || keypoints.length < 17) return empty('no pose');
  if (vw < 16 || vh < 16) return empty('frame too small');

  const scale = poseScaleUnit(keypoints, vw, vh);
  if (!scale) return empty('pose too weak for a scale unit');

  const px = (i: number) => {
    const k = keypoints[i];
    if (!k || k.score < 0.2) return null;
    return { x: k.x * vw, y: k.y * vh };
  };
  const wristL = px(9), wristR = px(10);
  const elbowL = px(7), elbowR = px(8);
  if (!wristL && !wristR) return empty('no confident wrist');

  // Forearm length is the per-arm scale for the sweep. When the elbow is missing
  // the shoulder-width unit stands in — it is the same order of magnitude and the
  // sweep only needs the right ballpark, not a precise limb measurement.
  const forearm = (w: { x: number; y: number } | null, e: { x: number; y: number } | null) =>
    w && e ? Math.max(8, Math.hypot(w.x - e.x, w.y - e.y)) : Math.max(8, scale.unit * 0.75);
  const faL = forearm(wristL, elbowL);
  const faR = forearm(wristR, elbowR);

  // ── The BODY EXCLUSION, taken from the shipped rasterizer ──────────────────
  //
  // `implementReach: 0` collapses the wrist→tip implement capsule down to a small
  // disc at the wrist, so what comes back is the player's body WITHOUT the racket
  // corridor. That is exactly the region a racket ray must not be scored inside.
  //
  // Reusing the rasterizer rather than re-deriving capsule geometry is deliberate:
  // a second implementation would be free to drift from the real zone and would
  // then exclude a different shape than the one the rest of the pipeline believes
  // in — the same class of quiet lie the debug overlay's `shapes` exists to avoid.
  let body: Uint8Array | null = null;
  try {
    body = buildSkeletonShapeRegion(keypoints, vw, vh, { implementReach: 0 })?.region ?? null;
  } catch {
    body = null;
  }
  if (!body) return empty('could not rasterize the body shape to exclude');
  const bodyMask = body;

  // ── Motion-diff patch covering both wrists' sweep discs ───────────────────
  const rMaxL = faL * R_MAX_FOREARM;
  const rMaxR = faR * R_MAX_FOREARM;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p: { x: number; y: number } | null, r: number) => {
    if (!p) return;
    x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
  };
  grow(wristL, rMaxL);
  grow(wristR, rMaxR);
  const rx = Math.max(0, Math.floor(x0));
  const ry = Math.max(0, Math.floor(y0));
  const rw = Math.min(vw, Math.ceil(x1)) - rx;
  const rh = Math.min(vh, Math.ceil(y1)) - ry;
  if (rw < 8 || rh < 8) return empty('sweep region degenerate');

  const s = Math.min(1, WORK_MAX_EDGE / Math.max(rw, rh));
  const w = Math.max(8, Math.round(rw * s));
  const h = Math.max(8, Math.round(rh * s));
  const cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return empty('no 2d context');

  ctx.drawImage(sourceFrame, rx, ry, rw, rh, 0, 0, w, h);
  const cur = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  const bs = background.scale;
  ctx.drawImage(background.bitmap, rx * bs, ry * bs, rw * bs, rh * bs, 0, 0, w, h);
  const bg = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d =
      Math.abs(cur.data[o] - bg.data[o]) +
      Math.abs(cur.data[o + 1] - bg.data[o + 1]) +
      Math.abs(cur.data[o + 2] - bg.data[o + 2]);
    const tRaw = (d - T_LOW) / (T_HIGH - T_LOW);
    const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw * tRaw * (3 - 2 * tRaw);
    alpha[i] = Math.round(t * 255);
  }

  /** Sample the diff at a FULL-FRAME point, or -1 when unusable (off-patch or body). */
  const sampleAt = (fx: number, fy: number): number => {
    if (fx < 0 || fy < 0 || fx >= vw || fy >= vh) return -1;
    if (bodyMask[(fy | 0) * vw + (fx | 0)] === 1) return -1;   // inside the player — excluded
    const sx = Math.round((fx - rx) * s);
    const sy = Math.round((fy - ry) * s);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return -1;
    return alpha[sy * w + sx];
  };

  const sweepOne = (
    wrist: { x: number; y: number } | null,
    forearmPx: number,
  ): { peak: RacketSweepPeak | null; profile: number[] | null } => {
    if (!wrist) return { peak: null, profile: null };
    const rMin = forearmPx * R_MIN_FOREARM;
    const rMax = forearmPx * R_MAX_FOREARM;
    const profile = new Array<number>(SWEEP_BINS).fill(0);
    const valid = new Array<boolean>(SWEEP_BINS).fill(false);

    for (let b = 0; b < SWEEP_BINS; b++) {
      const th = (b * SWEEP_STEP_DEG) / DEG;
      const ux = Math.cos(th), uy = Math.sin(th);
      let acc = 0, used = 0;
      for (let k = 0; k < RAY_SAMPLES; k++) {
        const r = rMin + ((rMax - rMin) * k) / (RAY_SAMPLES - 1);
        const v = sampleAt(wrist.x + ux * r, wrist.y + uy * r);
        if (v < 0) continue;
        acc += v; used++;
      }
      if (used >= RAY_SAMPLES * RAY_MIN_USABLE) {
        profile[b] = acc / used;
        valid[b] = true;
      }
    }

    const usable = profile.filter((_, b) => valid[b]);
    if (usable.length < SWEEP_BINS * 0.25) return { peak: null, profile };

    let bestB = -1, bestV = -1;
    for (let b = 0; b < SWEEP_BINS; b++) {
      if (valid[b] && profile[b] > bestV) { bestV = profile[b]; bestB = b; }
    }
    if (bestB < 0) return { peak: null, profile };

    const med = medianOf(usable);
    const confidence = bestV / Math.max(1, med);
    const theta = (bestB * SWEEP_STEP_DEG) / DEG;

    // Apparent length: the furthest sample along the winning ray still carrying
    // half the peak's energy. This is what the racket LOOKS like on this frame —
    // it foreshortens as the racket rotates out of plane, which is why Stage 2
    // fits it over time rather than assuming a constant.
    const ux = Math.cos(theta), uy = Math.sin(theta);
    let reachPx = rMin;
    for (let k = 0; k < RAY_SAMPLES; k++) {
      const r = rMin + ((rMax - rMin) * k) / (RAY_SAMPLES - 1);
      const v = sampleAt(wrist.x + ux * r, wrist.y + uy * r);
      if (v >= bestV * 0.5) reachPx = r;
    }

    return { peak: { theta, confidence, peakEnergy: bestV, reachPx }, profile };
  };

  const L = sweepOne(wristL, faL);
  const R = sweepOne(wristR, faR);

  return {
    frameIndex, timeSec,
    left: L.peak, right: R.peak,
    profileLeft: L.profile, profileRight: R.profile,
    wristLeft: wristL, wristRight: wristR,
    forearmLeftPx: faL, forearmRightPx: faR,
    reason: 'ok',
  };
}

// ── STAGE 2 — fit and repair ────────────────────────────────────────────────

/** Exact quadratic through three (t, y) points; null when the ts are degenerate. */
function quadThrough3(
  p: Array<{ t: number; y: number }>,
): ((t: number) => number) | null {
  const [A, B, C] = p;
  const d = (A.t - B.t) * (A.t - C.t) * (B.t - C.t);
  if (Math.abs(d) < 1e-9) return null;
  const a =
    (C.t * (B.y - A.y) + B.t * (A.y - C.y) + A.t * (C.y - B.y)) / d;
  const b =
    (C.t * C.t * (A.y - B.y) + B.t * B.t * (C.y - A.y) + A.t * A.t * (B.y - C.y)) / d;
  const c =
    (B.t * C.t * (B.t - C.t) * A.y +
      C.t * A.t * (C.t - A.t) * B.y +
      A.t * B.t * (A.t - B.t) * C.y) / d;
  return (t: number) => a * t * t + b * t + c;
}

/**
 * Ordinary least-squares polynomial fit, capped at `maxDegree`.
 *
 * The cap is load bearing, not a convenience: fitting a 3-parameter quadratic to
 * barely more than three points reproduces the noise rather than the swing, and
 * its residual then understates the error precisely when the fit is least
 * trustworthy. Callers step the order down when they cannot afford a curve.
 */
function fitQuad(p: Array<{ t: number; y: number }>, maxDegree = 2): (t: number) => number {
  const n = p.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => p[0].y;
  const deg = Math.min(maxDegree, n >= 3 ? 2 : 1);
  const m = deg + 1;
  // Normal equations for a Vandermonde system, solved by Gaussian elimination.
  const M: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (const { t, y } of p) {
    const pw = [1, t, t * t].slice(0, m);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) M[i][j] += pw[i] * pw[j];
      M[i][m] += pw[i] * y;
    }
  }
  for (let i = 0; i < m; i++) {
    let piv = i;
    for (let r = i + 1; r < m; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if (Math.abs(M[piv][i]) < 1e-12) return () => p.reduce((s, q) => s + q.y, 0) / n;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = 0; r < m; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let cIdx = i; cIdx <= m; cIdx++) M[r][cIdx] -= f * M[i][cIdx];
    }
  }
  // Full Gauss-JORDAN above (every row other than the pivot is eliminated), so M
  // is diagonal here and each coefficient is just its own row's rhs over pivot.
  const co = M.map((row, i) => row[m] / row[i]);
  return (t: number) => co.reduce((s, c, i) => s + c * Math.pow(t, i), 0);
}

interface HandFit {
  hand: RacketHand;
  accepted: boolean;
  inliers: number;
  rmsDeg: number;
  theta: (t: number) => number;
  length: (t: number) => number;
  inlierSet: Set<number>;
  reason: string;
}

function fitHand(sweeps: RacketFrameSweep[], hand: RacketHand): HandFit {
  const fail = (reason: string): HandFit => ({
    hand, accepted: false, inliers: 0, rmsDeg: Infinity,
    theta: () => 0, length: () => 0, inlierSet: new Set(), reason,
  });

  const peakOf = (s: RacketFrameSweep) => (hand === 'left' ? s.left : s.right);

  /**
   * Does this model stay within a physically claimable angular rate across the
   * batch? Evaluated on the CONTINUOUS (unwrapped) model output, so this measures
   * the real motion the model asserts rather than its wrapped appearance.
   */
  const rateOk = (model: (t: number) => number, tsNorm: number[]): boolean => {
    const cap = MAX_STEP_DEG / DEG;
    const travelCap = MAX_TOTAL_TRAVEL_DEG / DEG;
    let travel = 0;
    for (let i = 1; i < tsNorm.length; i++) {
      const step = Math.abs(model(tsNorm[i]) - model(tsNorm[i - 1]));
      if (step > cap) return false;
      travel += step;
      if (travel > travelCap) return false;
    }
    return true;
  };

  // Normalize t to [0,1] across the batch so the quadratic stays well conditioned
  // regardless of the clip's absolute timestamps.
  const ts = sweeps.map((s) => s.timeSec);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const span = Math.max(1e-6, tMax - tMin);
  const T = (s: RacketFrameSweep) => (s.timeSec - tMin) / span;

  // Keyed by `frameIndex`, NOT by array position — the inlier set is read back
  // against `frameIndex` in fitRacketTrajectory, and the two are not the same
  // number whenever a batch skips frames.
  /** Every frame's normalized time, in order — the grid the rate cap is checked on. */
  const gridT = sweeps.map(T).sort((x, y) => x - y);

  const knots = sweeps
    .map((s) => ({ s, id: s.frameIndex, p: peakOf(s) }))
    .filter((k) => k.p && k.p.confidence >= CONF_MIN && k.p.peakEnergy >= PEAK_ENERGY_MIN);

  if (knots.length < MIN_KNOTS) {
    return fail(`only ${knots.length} confident knot(s), need ${MIN_KNOTS}`);
  }

  // RANSAC over 3-subsets. With ≤15 frames the subset count is trivial
  // (C(15,3)=455), so this is exhaustive rather than randomized — no seed, no
  // Math.random, and the same batch always yields the same fit.
  let best: { model: (t: number) => number; inliers: number[]; rms: number } | null = null;
  const tol = RESID_INLIER_DEG / DEG;

  for (let a = 0; a < knots.length - 2; a++) {
    for (let b = a + 1; b < knots.length - 1; b++) {
      for (let c = b + 1; c < knots.length; c++) {
        const trio = [knots[a], knots[b], knots[c]];
        // Unwrap the trio relative to the first, so the exact fit sees a
        // continuous curve rather than a 359°→1° cliff.
        const base = trio[0].p!.theta;
        const pts = trio.map((k) => ({ t: T(k.s), y: base + angDiff(k.p!.theta, base) }));
        const model = quadThrough3(pts);
        if (!model) continue;
        // Discard the fast-spinning models that can alias onto anything BEFORE
        // they get to claim inliers — otherwise they win on count every time.
        if (!rateOk(model, gridT)) continue;

        // Score EVERY knot by WRAPPED residual — immune to unwrap cascades.
        const inl: number[] = [];
        let sq = 0;
        for (const k of knots) {
          const r = Math.abs(angDiff(k.p!.theta, model(T(k.s))));
          if (r <= tol) { inl.push(k.id); sq += r * r; }
        }
        if (inl.length < MIN_INLIERS) continue;
        const rms = Math.sqrt(sq / inl.length) * DEG;
        if (!best || inl.length > best.inliers.length || (inl.length === best.inliers.length && rms < best.rms)) {
          best = { model, inliers: inl, rms };
        }
      }
    }
  }

  if (!best) return fail(`no trajectory reached ${MIN_INLIERS} inliers out of ${knots.length} knots`);

  // Chance can hand a 3-parameter model a handful of agreeing points on any data.
  // Requiring half the confident frames to agree is what separates a real arc
  // from a lucky subset — see the note on MIN_INLIER_FRACTION.
  if (best.inliers.length < knots.length * MIN_INLIER_FRACTION) {
    return fail(
      `only ${best.inliers.length}/${knots.length} knots agreed ` +
        `(need ${Math.ceil(knots.length * MIN_INLIER_FRACTION)})`,
    );
  }

  // Refit on the inliers, unwrapping against the RANSAC model so the least-squares
  // pass sees a continuous target.
  const inlierSet = new Set(best.inliers);
  const inlierKnots = knots.filter((k) => inlierSet.has(k.id));
  const thetaPts = inlierKnots.map((k) => {
    const guess = best!.model(T(k.s));
    return { t: T(k.s), y: guess + angDiff(k.p!.theta, guess) };
  });
  // Step the order DOWN when there are too few inliers to afford a curve, so the
  // residual below stays a real test rather than a restatement of the fit.
  const order = inlierKnots.length >= QUADRATIC_MIN_INLIERS ? 2 : 1;
  const theta = fitQuad(thetaPts, order);

  let sq = 0;
  for (const k of inlierKnots) sq += Math.pow(angDiff(k.p!.theta, theta(T(k.s))), 2);
  const rmsDeg = Math.sqrt(sq / inlierKnots.length) * DEG;

  if (rmsDeg > RESID_MAX_RMS_DEG) {
    return fail(`refit residual ${rmsDeg.toFixed(1)}° exceeds ${RESID_MAX_RMS_DEG}°`);
  }
  // The refit is a different curve from the RANSAC seed, so it has to clear the
  // rate cap on its own account rather than inheriting the seed's approval.
  if (!rateOk(theta, gridT)) {
    return fail(`refit exceeds ${MAX_STEP_DEG}°/frame — direction would be aliased`);
  }

  // Length over time, from the same inliers. No RANSAC — it is a scalar whose
  // outliers cost a slightly long or short axis, not a wrong direction.
  const length = fitQuad(inlierKnots.map((k) => ({ t: T(k.s), y: k.p!.reachPx })), order);

  return {
    hand, accepted: true, inliers: inlierKnots.length, rmsDeg,
    theta: (t) => theta((t - tMin) / span),
    length: (t) => length((t - tMin) / span),
    inlierSet, reason: 'ok',
  };
}

/**
 * STAGE 2 — fit both hand hypotheses over the batch and resolve one trajectory.
 *
 * Refuses the WHOLE batch when neither hand produces a trustworthy fit. That is
 * deliberate: in a Motion Layer composite every ghost overlays every later frame,
 * so one wrong axis is visible across the entire layer while a missing one is
 * invisible. Deciding once, with all the evidence, is strictly safer than fifteen
 * independent per-frame decisions.
 */
export function fitRacketTrajectory(sweeps: RacketFrameSweep[]): RacketTrajectory {
  if (sweeps.length === 0) {
    return { accepted: false, hand: null, axes: [], knots: 0, residualRmsDeg: Infinity, reason: 'no frames' };
  }

  const L = fitHand(sweeps, 'left');
  const R = fitHand(sweeps, 'right');
  const candidates = [L, R].filter((f) => f.accepted);

  if (!candidates.length) {
    return {
      accepted: false, hand: null, axes: [], knots: 0, residualRmsDeg: Infinity,
      reason: `no hand fitted (L: ${L.reason} | R: ${R.reason})`,
    };
  }

  // More inliers wins; equal inliers, lower residual wins.
  const win = candidates.reduce((bestF, f) =>
    f.inliers > bestF.inliers || (f.inliers === bestF.inliers && f.rmsDeg < bestF.rmsDeg) ? f : bestF);

  // A frame whose racket-hand wrist was never located has no origin to draw from,
  // so it is dropped here rather than emitted with a placeholder position.
  const axes: RacketAxis[] = sweeps.flatMap<RacketAxis>((s) => {
    const wrist = win.hand === 'left' ? s.wristLeft : s.wristRight;
    if (!wrist) return [];
    const forearm = win.hand === 'left' ? s.forearmLeftPx : s.forearmRightPx;
    const peak = win.hand === 'left' ? s.left : s.right;
    const profile = win.hand === 'left' ? s.profileLeft : s.profileRight;

    // The FITTED angle is used on every frame, including the frames that produced
    // it. That is the rectification: what is drawn is the trajectory, not a mix of
    // trajectory and per-frame noise. `source` still records where the evidence
    // came from, so a frame carried entirely by its neighbours is visible as such.
    const th = win.theta(s.timeSec);
    const rawLen = win.length(s.timeSec);
    const lengthPx = Math.max(forearm * LEN_MIN_FOREARM, Math.min(forearm * LEN_MAX_FOREARM, rawLen));

    const source: RacketArcSource =
      win.inlierSet.has(s.frameIndex) ? 'swept' : peak ? 'rejected' : 'fitted';

    return [{
      frameIndex: s.frameIndex,
      timeSec: s.timeSec,
      origin: wrist,
      theta: th,
      lengthPx,
      source,
      confidence: peak?.confidence ?? 0,
      profile,
      profileRadiusPx: forearm * R_MAX_FOREARM,
    }];
  });

  return {
    accepted: true,
    hand: win.hand,
    axes,
    knots: win.inliers,
    residualRmsDeg: win.rmsDeg,
    reason: 'ok',
  };
}

/**
 * Convenience: sweep every frame, then fit. Logs one `[racketArc]` line per frame
 * plus a batch verdict, so the whole pass is readable from the console alone.
 */
export async function buildRacketTrajectory(
  frames: Array<{
    frameIndex: number;
    timeSec: number;
    sourceFrame: ImageBitmap;
    keypoints: NormKeypoint[] | null | undefined;
  }>,
  background: { bitmap: ImageBitmap; scale: number } | null | undefined,
  vw: number,
  vh: number,
): Promise<RacketTrajectory> {
  const sweeps: RacketFrameSweep[] = [];
  for (const f of frames) {
    const sw = await sweepRacketFrame({
      sourceFrame: f.sourceFrame,
      background,
      keypoints: f.keypoints,
      vw, vh,
      frameIndex: f.frameIndex,
      timeSec: f.timeSec,
    });
    sweeps.push(sw);
    const fmt = (p: RacketSweepPeak | null) =>
      p ? `${(p.theta * DEG).toFixed(0)}° conf=${p.confidence.toFixed(2)} e=${p.peakEnergy.toFixed(0)} reach=${p.reachPx.toFixed(0)}px` : 'none';
    // eslint-disable-next-line no-console
    console.log(
      `[racketArc] sweep frame=${f.frameIndex} t=${f.timeSec.toFixed(3)} ` +
        `L=(${fmt(sw.left)}) R=(${fmt(sw.right)}) :: ${sw.reason}`,
    );
  }

  const traj = fitRacketTrajectory(sweeps);

  if (!traj.accepted) {
    // eslint-disable-next-line no-console
    console.log(`[racketArc] BATCH REJECTED — no axis drawn. ${traj.reason}`);
    return traj;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[racketArc] BATCH ACCEPTED hand=${traj.hand} knots=${traj.knots}/${sweeps.length} ` +
      `residual=${traj.residualRmsDeg.toFixed(1)}°`,
  );
  for (const a of traj.axes) {
    // eslint-disable-next-line no-console
    console.log(
      `[racketArc] frame=${a.timeSec.toFixed(3)} peak=${(a.theta * DEG).toFixed(0)}° ` +
        `conf=${a.confidence.toFixed(2)} len=${a.lengthPx.toFixed(0)}px source=${a.source}`,
    );
  }
  return traj;
}
