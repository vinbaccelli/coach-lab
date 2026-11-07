/**
 * Skeleton benchmark metrics (pure, no DOM). Used by tests/skeletonBench.test.ts
 * and scripts/skeleton-bench/analyze.ts so Stage 2 changes get before/after
 * numbers on the same definitions.
 *
 * Two families:
 *  - trackStats:     no ground truth needed (works on real clips): missing frames,
 *                    frame-to-frame jumps, left/right swaps, jerk, bone-length drift.
 *  - compareToTruth: needs ground truth (synthetic clips): joint error, wrist
 *                    peak-speed retention (does smoothing eat real swings?), lag.
 *
 * All distances are normalised by body height (median shoulder→ankle y-extent)
 * so numbers are comparable across resolutions.
 */

export const USE_JOINTS = [
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
] as const;

export const LR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['left_shoulder', 'right_shoulder'], ['left_elbow', 'right_elbow'], ['left_wrist', 'right_wrist'],
  ['left_hip', 'right_hip'], ['left_knee', 'right_knee'], ['left_ankle', 'right_ankle'],
];

export const BONES: ReadonlyArray<readonly [string, string]> = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
];

export type Pt = { x: number; y: number; vis?: number };
export type Pose = Record<string, Pt>;
export type Seq = Array<Pose | null>;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const present = (p: Pose | null): p is Pose => !!p && USE_JOINTS.every((n) => p[n]);

/** Joints that define body height: torso + legs only. Arms are excluded on purpose — a raised racket arm would inflate the scale mid-swing. */
const HEIGHT_JOINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'] as const;

/** Median shoulder→ankle y-extent (torso+legs joints), in px. NOTE: the Phase-1 audit scripts used all 12 joints; numbers differ slightly. */
export function bodyHeight(seq: Seq): number {
  const h = seq.filter(present).map((k) => {
    const ys = HEIGHT_JOINTS.map((n) => k[n].y);
    return Math.max(...ys) - Math.min(...ys);
  });
  return median(h);
}

export interface TrackStats {
  frames: number;
  detected: number;
  missing: number;
  bodyHeightPx: number;
  /** Fraction of joint steps larger than `jumpStep` body-heights per frame. */
  jumpRate: number;
  jumps: number;
  /** Frames where L/R of a pair crossed over (matches the other side's previous position better). */
  swaps: number;
  maxStep: number;
  jerkMedian: number;
  jerkP95: number;
  jerkP99: number;
  /** Mean over bones of std/median of bone length (0 = rigid). Foreshortening on real video raises this legitimately: compare runs, don't treat as absolute. */
  boneLengthCV: number;
  /** Fraction of (frame,bone) with length outside ±35 % of that bone's median. */
  boneViolationRate: number;
}

/** `minScore` > 0 evaluates only joints the app would draw (vis ≥ minScore); hidden joints count as unknown, not as errors. */
export function trackStats(seq: Seq, opts: { jumpStep?: number; swapMinSeparation?: number; minScore?: number } = {}): TrackStats {
  const minScore = opts.minScore ?? 0;
  const use = (k: Pt | undefined): k is Pt => !!k && (k.vis ?? 1) >= minScore;
  const jumpStep = opts.jumpStep ?? 0.12;
  const minSep = opts.swapMinSeparation ?? 0.05;
  const ok = seq.filter(present);
  const base: TrackStats = {
    frames: seq.length, detected: ok.length, missing: seq.length - ok.length, bodyHeightPx: NaN,
    jumpRate: 0, jumps: 0, swaps: 0, maxStep: 0, jerkMedian: 0, jerkP95: 0, jerkP99: 0,
    boneLengthCV: 0, boneViolationRate: 0,
  };
  if (ok.length < 4) return base;
  const H = bodyHeight(seq);
  base.bodyHeightPx = H;

  let jumps = 0, n = 0, swaps = 0, maxStep = 0;
  const jerk: number[] = [];
  for (let i = 2; i < seq.length; i++) {
    const a = seq[i - 2], b = seq[i - 1], c = seq[i];
    if (!a || !b || !c) continue;
    for (const nm of USE_JOINTS) {
      if (!use(a[nm]) || !use(b[nm]) || !use(c[nm])) continue;
      const s = dist(b[nm], c[nm]) / H;
      n++;
      if (s > jumpStep) jumps++;
      if (s > maxStep) maxStep = s;
      jerk.push(Math.hypot(c[nm].x - 2 * b[nm].x + a[nm].x, c[nm].y - 2 * b[nm].y + a[nm].y) / H);
    }
    for (const [L, R] of LR_PAIRS) {
      if (!use(b[L]) || !use(b[R]) || !use(c[L]) || !use(c[R])) continue;
      const keep = dist(c[L], b[L]) + dist(c[R], b[R]);
      const swp = dist(c[L], b[R]) + dist(c[R], b[L]);
      if (swp < keep * 0.6 && dist(b[L], b[R]) / H > minSep) swaps++;
    }
  }
  jerk.sort((x, y) => x - y);

  let cvSum = 0, viol = 0, vn = 0;
  for (const [A, B] of BONES) {
    const lens = ok.filter((k) => use(k[A]) && use(k[B])).map((k) => dist(k[A], k[B]));
    if (lens.length < 2) continue;
    const med = median(lens);
    if (!(med > 0)) continue;
    const mean = lens.reduce((s, v) => s + v, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / lens.length);
    cvSum += sd / med;
    for (const l of lens) { vn++; if (Math.abs(l / med - 1) > 0.35) viol++; }
  }

  return {
    ...base, jumps, swaps, maxStep,
    jumpRate: n ? jumps / n : 0,
    jerkMedian: jerk.length ? pct(jerk, 0.5) : 0,
    jerkP95: jerk.length ? pct(jerk, 0.95) : 0,
    jerkP99: jerk.length ? pct(jerk, 0.99) : 0,
    boneLengthCV: cvSum / BONES.length,
    boneViolationRate: vn ? viol / vn : 0,
  };
}

export interface TruthComparison {
  /** Joint error / body height, over frames where both exist. */
  meanError: number;
  p95Error: number;
  maxError: number;
  /** Per-joint mean error (body heights). */
  perJoint: Record<string, number>;
  /** Peak 3-frame wrist displacement, estimate ÷ truth. <1 = swing flattened by smoothing; ≈1 = preserved. */
  wristPeakRatio: number;
  /** Integer frame lag of the right wrist that best aligns estimate to truth (+ = estimate lags). */
  wristLagFrames: number;
  /** Frames where the estimate has a joint closer to the truth's opposite side than its own (L/R swap vs truth). */
  swapsVsTruth: number;
  missing: number;
}

/** `minScore` > 0 scores only joints the app would DRAW (vis ≥ minScore) — what the coach sees; joints below it count as unknown, not as errors. */
export function compareToTruth(est: Seq, truth: Seq, wrist = 'right_wrist', minScore = 0): TruthComparison {
  const H = bodyHeight(truth);
  const errs: number[] = [];
  const per: Record<string, number[]> = {};
  let swaps = 0, missing = 0;
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i], e = est[i];
    if (!t) continue;
    if (!e) { missing++; continue; }
    for (const nm of USE_JOINTS) {
      if (!e[nm] || !t[nm]) continue;
      if ((e[nm].vis ?? 1) < minScore) continue;
      const d = dist(e[nm], t[nm]) / H;
      errs.push(d);
      (per[nm] ||= []).push(d);
    }
    for (const [L, R] of LR_PAIRS) {
      if (!e[L] || !e[R]) continue;
      if (dist(t[L], t[R]) / H < 0.05) continue;
      if (dist(e[L], t[R]) + dist(e[R], t[L]) < 0.6 * (dist(e[L], t[L]) + dist(e[R], t[R]))) swaps++;
    }
  }
  errs.sort((a, b) => a - b);
  const perJoint: Record<string, number> = {};
  for (const [k, v] of Object.entries(per)) perJoint[k] = v.reduce((s, x) => s + x, 0) / v.length;

  const peak = (s: Seq) => {
    let m = 0;
    for (let i = 3; i < s.length; i++) {
      const a = s[i - 3], b = s[i];
      if (a && b && a[wrist] && b[wrist]) m = Math.max(m, dist(a[wrist], b[wrist]));
    }
    return m;
  };
  const pt = peak(truth);

  let bestLag = 0, bestErr = Infinity;
  for (let lag = -8; lag <= 8; lag++) {
    let s = 0, c = 0;
    for (let i = 0; i < truth.length; i++) {
      const t = truth[i], e = est[i + lag];
      if (!t || !e || !t[wrist] || !e[wrist]) continue;
      s += dist(t[wrist], e[wrist]) ** 2; c++;
    }
    if (c > truth.length / 2 && s / c < bestErr) { bestErr = s / c; bestLag = lag; }
  }

  return {
    meanError: errs.length ? errs.reduce((s, v) => s + v, 0) / errs.length : NaN,
    p95Error: errs.length ? pct(errs, 0.95) : NaN,
    maxError: errs.length ? errs[errs.length - 1] : NaN,
    perJoint,
    wristPeakRatio: pt > 0 ? peak(est) / pt : NaN,
    wristLagFrames: bestLag,
    swapsVsTruth: swaps,
    missing,
  };
}

const ARM_JOINTS = ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'];
const LEG_JOINTS = ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

export interface CrossClass {
  /** An arm joint moved to (near) where a LEG joint was in the previous frame. */
  armToLeg: number;
  /** A leg joint moved to where an ARM joint was. */
  legToArm: number;
  /** Frames where the median joint moved > 0.25 body heights (identity switch / hallucinated body). */
  wholeBodyJumps: number;
}

/**
 * "Legs as arms" detector: counts joints that jump to the previous position of a
 * limb of the OTHER class (closer than half their own step, step ≥ 0.12 body heights).
 * Left/right swaps within a class are counted by trackStats().swaps instead.
 */
export function crossClassJumps(seq: Seq, minScore = 0): CrossClass {
  const H = bodyHeight(seq);
  let armToLeg = 0, legToArm = 0, whole = 0;
  const use = (k: Pt | undefined): k is Pt => !!k && (k.vis ?? 1) >= minScore;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (!a || !b) continue;
    const steps = Object.keys(b).filter((k) => a[k]).map((k) => dist(a[k], b[k]) / H).sort((x, y) => x - y);
    if (steps.length && steps[steps.length >> 1] > 0.25) whole++;
    for (const [grp, other, isArm] of [[ARM_JOINTS, LEG_JOINTS, true], [LEG_JOINTS, ARM_JOINTS, false]] as const) {
      for (const j of grp) {
        if (!use(a[j]) || !use(b[j])) continue;
        const own = dist(a[j], b[j]);
        if (own / H < 0.12) continue;
        const near = Math.min(...other.filter((k) => use(a[k])).map((k) => dist(a[k], b[j])));
        if (near < own * 0.5) { if (isArm) armToLeg++; else legToArm++; }
      }
    }
  }
  return { armToLeg, legToArm, wholeBodyJumps: whole };
}
