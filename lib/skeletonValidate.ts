/**
 * Per-joint validation of a baked pose track, BEFORE smoothing.
 *
 * Why: the detector is confident about wrong joints (limb swaps, a wrist
 * snapping to the background), and smoothing a wrong joint just makes it drift
 * ("drunk" skeleton). So we judge every joint on evidence, never on the box:
 *
 *  1. L/R SWAP REPAIR   — a left/right pair whose labels jumped to the other
 *     side's previous position is swapped back (compared with the previous
 *     OUTPUT frame, so a swap that persists is repaired consistently).
 *  2. CONFIDENCE        — joint score < MIN_SCORE is invalid.
 *  3. TEMPORAL OUTLIER  — a joint far from the midpoint of its valid neighbours
 *     (velocity-independent, so genuine fast swings pass).
 *  4. BONE LENGTH       — a bone much longer than its local median length
 *     implicates the endpoint that deviates more from its neighbours.
 *
 * Invalid joints are NOT deleted or invented: their score is capped to
 * INVALID_SCORE so every consumer (overlay, angles → "–", smoother weight,
 * playback lerp which takes min(score)) treats them as unknown. No extra
 * smoothing is applied here, so real high-speed movement is untouched.
 */
import type { TrackSample, TrackKeypoint } from './trackSmoothing';

export const MIN_SCORE = 0.2;
export const INVALID_SCORE = 0.05;
const SWAP_RATIO = 0.6;          // swapped assignment must be this much cheaper
const SWAP_MIN_SEP = 0.08;       // L/R must be ≥ this many body heights apart (else crossing, not a swap)
const SWAP_MIN_MOVE = 0.04;      // …and the unswapped step must be a real move
const OUTLIER_BH = 0.25;         // distance from neighbour midpoint, in body heights
const BONE_LONG = 1.5;           // × local median length
const BONE_BLAME_BH = 0.08;      // blamed endpoint must also be off its neighbours by this much
const NEIGHBOUR_MAX_DT = 0.12;   // neighbours further apart than this (s) aren't a usable reference
const LOCAL_HALF = 10;           // samples each side for local bone median
const LAYOUT_LONG = 1.5;         // frame gate: a limb bone this much longer than its local median is off…
const LAYOUT_SHORT = 0.6;        // …or this much shorter (arms↔legs swap changes both)
const LAYOUT_MIN_OFF = 3;        // frame is implausible when ≥ this many of the 8 limb bones are off (of ≥ 4 measurable)
const ORDER_MARGIN_BH = 0.1;     // shoulders above hips above ankles, by at least this many body heights

const SWAP_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['left_shoulder', 'right_shoulder'], ['left_elbow', 'right_elbow'], ['left_wrist', 'right_wrist'],
  ['left_hip', 'right_hip'], ['left_knee', 'right_knee'], ['left_ankle', 'right_ankle'],
];
const BONES: ReadonlyArray<readonly [string, string]> = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];
const HEIGHT_JOINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

export interface ValidationReport {
  samples: number;
  /** Frames whose whole limb layout is implausible (e.g. legs where arms should be): dropped like a missed detection. */
  droppedFrames: number;
  swapsFixed: number;
  invalidLowScore: number;
  invalidOutlier: number;
  invalidBone: number;
}

const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Index = Map<string, TrackKeypoint>;

export function validateTrack(samples: TrackSample[]): { samples: TrackSample[]; report: ValidationReport; dropped: boolean[] } {
  const report: ValidationReport = { samples: samples.length, droppedFrames: 0, swapsFixed: 0, invalidLowScore: 0, invalidOutlier: 0, invalidBone: 0 };
  const noDrops = () => new Array<boolean>(samples.length).fill(false);
  if (samples.length < 4) return { samples, report, dropped: noDrops() };

  const out: TrackSample[] = samples.map((s) => ({ t: s.t, kps: s.kps.map((k) => ({ ...k })) }));
  const idx: Index[] = out.map((s) => new Map(s.kps.filter((k) => k.name).map((k) => [k.name, k])));

  // Body height: median shoulder→ankle extent over frames where all eight joints are confident.
  const hs: number[] = [];
  for (const m of idx) {
    const ks = HEIGHT_JOINTS.map((n) => m.get(n));
    if (ks.every((k) => k && k.score >= 0.3)) { const ys = ks.map((k) => k!.y); hs.push(Math.max(...ys) - Math.min(...ys)); }
  }
  if (hs.length < 4) return { samples, report, dropped: noDrops() };
  const BH = median(hs);
  if (!(BH > 20)) return { samples, report, dropped: noDrops() };

  // ── 1. L/R swaps, greedy against the previous output frame ──────────────
  for (let i = 1; i < out.length; i++) {
    const prev = idx[i - 1], cur = idx[i];
    for (const [L, R] of SWAP_PAIRS) {
      const pL = prev.get(L), pR = prev.get(R), cL = cur.get(L), cR = cur.get(R);
      if (!pL || !pR || !cL || !cR) continue;
      if (pL.score < 0.3 || pR.score < 0.3 || cL.score < 0.3 || cR.score < 0.3) continue;
      if (d(pL, pR) / BH < SWAP_MIN_SEP) continue;
      const keep = d(cL, pL) + d(cR, pR);
      const swp = d(cL, pR) + d(cR, pL);
      if (keep / BH > SWAP_MIN_MOVE && swp < keep * SWAP_RATIO) {
        const t = { x: cL.x, y: cL.y, score: cL.score };
        cL.x = cR.x; cL.y = cR.y; cL.score = cR.score;
        cR.x = t.x; cR.y = t.y; cR.score = t.score;
        report.swapsFixed++;
      }
    }
  }

  // Neighbour-midpoint prediction for a joint at sample i (needs valid samples either side, close in time).
  const valid = (i: number, n: string) => { const k = idx[i]?.get(n); return k && k.score >= MIN_SCORE ? k : null; };
  const deviation = (i: number, n: string): number | null => {
    const k = idx[i].get(n);
    if (!k) return null;
    let a = -1, b = -1;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (valid(j, n)) { a = j; break; }
    for (let j = i + 1; j <= Math.min(out.length - 1, i + 3); j++) if (valid(j, n)) { b = j; break; }
    if (a < 0 || b < 0) return null;
    if (out[b].t - out[a].t > NEIGHBOUR_MAX_DT * 2) return null;
    const ka = idx[a].get(n)!, kb = idx[b].get(n)!;
    const f = out[b].t === out[a].t ? 0.5 : (out[i].t - out[a].t) / (out[b].t - out[a].t);
    return d(k, { x: ka.x + (kb.x - ka.x) * f, y: ka.y + (kb.y - ka.y) * f }) / BH;
  };

  const bad = new Set<string>(); // `${i}|${name}` decided on the ORIGINAL scores, applied after all checks
  const mark = (i: number, n: string, why: 'invalidLowScore' | 'invalidOutlier' | 'invalidBone') => {
    const key = `${i}|${n}`;
    if (!bad.has(key)) { bad.add(key); report[why]++; }
  };

  // ── 2 + 3. confidence and temporal outliers ─────────────────────────────
  for (let i = 0; i < out.length; i++) {
    for (const [n, k] of idx[i]) {
      if (k.score < MIN_SCORE) { if (k.score > INVALID_SCORE) mark(i, n, 'invalidLowScore'); continue; }
      const dev = deviation(i, n);
      if (dev != null && dev > OUTLIER_BH) mark(i, n, 'invalidOutlier');
    }
  }

  // ── 4. bone lengths against a LOCAL median (tolerates zoom / approach) ──
  for (const [A, B] of BONES) {
    const len: Array<number | null> = idx.map((m, i) => (valid(i, A) && valid(i, B) ? d(m.get(A)!, m.get(B)!) : null));
    for (let i = 0; i < out.length; i++) {
      const l = len[i];
      if (l == null) continue;
      const win: number[] = [];
      for (let j = Math.max(0, i - LOCAL_HALF); j <= Math.min(out.length - 1, i + LOCAL_HALF); j++) if (len[j] != null && j !== i) win.push(len[j]!);
      if (win.length < 4) continue;
      if (l <= median(win) * BONE_LONG) continue;
      const dA = deviation(i, A) ?? 0, dB = deviation(i, B) ?? 0;
      const blame = dA >= dB ? A : B;
      if (Math.max(dA, dB) > BONE_BLAME_BH) mark(i, blame, 'invalidBone');
    }
  }

  // ── 5. FRAME LAYOUT GATE: a sustained wrong layout (legs where arms belong, a
  // hallucinated body on a small player) passes every per-joint test above because
  // its neighbours are wrong too. Judge the frame as a whole: several limb bones far
  // from their local median length at once, or the vertical order of shoulders / hips /
  // ankles inverted. Such a frame is dropped = treated exactly like a missed detection
  // (playback interpolates across short holes, snaps across long ones).
  const dropped = noDrops();
  const limbLen = (i: number, [A, B]: readonly [string, string]) => (valid(i, A) && valid(i, B) ? d(idx[i].get(A)!, idx[i].get(B)!) : null);
  const lens = BONES.map((bn) => out.map((_, i) => limbLen(i, bn)));
  const mean = (ks: Array<{ y: number } | null | undefined>) => { const v = ks.filter((k): k is { y: number } => !!k); return v.length ? v.reduce((a, k) => a + k.y, 0) / v.length : null; };
  for (let i = 0; i < out.length; i++) {
    let checked = 0, off = 0;
    BONES.forEach((_, b) => {
      const l = lens[b][i];
      if (l == null) return;
      const win: number[] = [];
      for (let j = Math.max(0, i - LOCAL_HALF * 2); j <= Math.min(out.length - 1, i + LOCAL_HALF * 2); j++) if (lens[b][j] != null && j !== i) win.push(lens[b][j]!);
      if (win.length < 6) return;
      checked++;
      const m = median(win);
      if (l > m * LAYOUT_LONG || l < m * LAYOUT_SHORT) off++;
    });
    const sh = mean([valid(i, 'left_shoulder'), valid(i, 'right_shoulder')]);
    const hip = mean([valid(i, 'left_hip'), valid(i, 'right_hip')]);
    const an = mean([valid(i, 'left_ankle'), valid(i, 'right_ankle')]);
    const inverted = sh != null && hip != null && an != null && !(sh < hip - ORDER_MARGIN_BH * BH && hip < an - ORDER_MARGIN_BH * BH);
    if ((checked >= 4 && off >= LAYOUT_MIN_OFF) || (inverted && off >= 1)) { dropped[i] = true; report.droppedFrames++; }
  }

  for (const key of bad) {
    const [si, n] = key.split('|');
    const k = idx[+si].get(n);
    if (k) k.score = Math.min(k.score, INVALID_SCORE);
  }
  return { samples: out, report, dropped };
}
