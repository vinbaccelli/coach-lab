/**
 * Deterministic synthetic tennis-like skeleton tracks with KNOWN ground truth,
 * plus corruption models that mimic the failure modes seen on real footage
 * (jitter, teleporting joints, left/right swaps, dropped frames).
 *
 * Purpose: unit-test the metrics and later the Stage-2 filters against truth.
 * These are kinematic stick figures, NOT video: they say nothing about how the
 * detector behaves on real pixels, so they can never prove a real-world
 * accuracy gain (see docs/SKELETON_BENCH.md, limitations).
 *
 * Bone lengths are constant by construction (two-bone IK for legs), so any
 * bone-length drift in a corrupted copy is attributable to the corruption.
 */
import type { Pose, Seq } from './metrics';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export type SwingKind = 'forehand' | 'serve' | 'lateral';

export interface SynthOpts {
  kind: SwingKind;
  frames?: number;     // default 90
  fps?: number;        // default 60
  /** Shoulder→ankle extent in px (default 600, i.e. a large player on 1080p). */
  bodyPx?: number;
  cx?: number;
  groundY?: number;
}

const smoother = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * c * (c * (c * 6 - 15) + 10); };

/** Point at distance a from P and b from Q, on the `side` (±1) of line PQ. */
function ik(P: { x: number; y: number }, Q: { x: number; y: number }, a: number, b: number, side: number) {
  let dx = Q.x - P.x, dy = Q.y - P.y;
  let d = Math.hypot(dx, dy);
  const maxD = a + b - 1e-6;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const ux = dx / d, uy = dy / d;
  return { x: P.x + ux * along - uy * h * side, y: P.y + uy * along + ux * h * side };
}

export function synthSwing(o: SynthOpts): Pose[] {
  const N = o.frames ?? 90, fps = o.fps ?? 60, B = o.bodyPx ?? 600;
  const cx0 = o.cx ?? 960, gy = o.groundY ?? 1000;
  const thigh = 0.31 * B, shin = 0.31 * B, torso = 0.38 * B;
  const upper = 0.2 * B, fore = 0.2 * B;
  const out: Pose[] = [];
  // Swing window: ~0.3 s wide, centred mid-clip. Peak wrist speed lands in the middle.
  const swingT = 0.3 * fps;
  const mid = N / 2;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const u = (i - (mid - swingT / 2)) / swingT;
    const e = smoother(u);
    const lateral = o.kind === 'lateral' ? (s - 0.5) * 1.2 * B : 0;
    const jump = o.kind === 'serve' ? Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.5) * 2)))) * 0.06 * B : 0;
    const bob = 0.02 * B * Math.sin(2 * Math.PI * s * (o.kind === 'lateral' ? 4 : 1));
    const hipC = { x: cx0 + lateral + 0.04 * B * Math.sin(2 * Math.PI * s), y: gy - 0.58 * B - bob - jump };
    const twist = Math.cos(0.9 * e); // shoulder-width foreshortening during rotation
    const hw = 0.18 * B, sw = 0.25 * B * twist;
    const lean = 0.05 * Math.sin(2 * Math.PI * s);
    const shC = { x: hipC.x + torso * Math.sin(lean), y: hipC.y - torso * Math.cos(lean) };

    // Image-plane convention: "left_*" joints are drawn on the image's left side.
    const hipL = { x: hipC.x - hw / 2, y: hipC.y }, hipR = { x: hipC.x + hw / 2, y: hipC.y };
    const shL = { x: shC.x - sw / 2, y: shC.y }, shR = { x: shC.x + sw / 2, y: shC.y };

    // Racket arm (right): sweeps through an arc; serve starts arm-up, forehand starts behind.
    const th0 = o.kind === 'serve' ? -Math.PI * 0.55 : -0.35 * Math.PI;
    const dth = o.kind === 'serve' ? 3.4 : 3.2;
    const th = th0 + dth * e;
    const elR = { x: shR.x + upper * Math.cos(th), y: shR.y - upper * Math.sin(th) };
    const wrR = { x: elR.x + fore * Math.cos(th + 0.4), y: elR.y - fore * Math.sin(th + 0.4) };
    // Off arm (left): small counter-swing.
    const thL = Math.PI * 1.05 - 0.5 * e;
    const elL = { x: shL.x + upper * Math.cos(thL), y: shL.y - upper * Math.sin(thL) };
    const wrL = { x: elL.x + fore * Math.cos(thL - 0.3), y: elL.y - fore * Math.sin(thL - 0.3) };

    // Legs: ankles planted (lift with the jump / lateral steps), knees via IK.
    const step = o.kind === 'lateral' ? 0.06 * B * Math.sin(2 * Math.PI * s * 4) : 0;
    const anL = { x: hipL.x - 0.04 * B + step, y: gy - jump - Math.max(0, step) * 0.5 };
    const anR = { x: hipR.x + 0.04 * B - step, y: gy - jump - Math.max(0, -step) * 0.5 };
    const knL = ik(hipL, anL, thigh, shin, -1);
    const knR = ik(hipR, anR, thigh, shin, 1);

    const P = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, vis: 0.99 });
    out.push({
      left_shoulder: P(shL), right_shoulder: P(shR), left_elbow: P(elL), right_elbow: P(elR),
      left_wrist: P(wrL), right_wrist: P(wrR), left_hip: P(hipL), right_hip: P(hipR),
      left_knee: P(knL), right_knee: P(knR), left_ankle: P(anL), right_ankle: P(anR),
    });
  }
  return out;
}

const cloneSeq = (s: Seq): Seq => s.map((p) => (p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v }])) : null));

/** Gaussian per-joint noise, σ in px. */
export function addJitter(seq: Seq, sigmaPx: number, rng: () => number): Seq {
  const o = cloneSeq(seq);
  for (const p of o) if (p) for (const k of Object.keys(p)) { p[k].x += gauss(rng) * sigmaPx; p[k].y += gauss(rng) * sigmaPx; }
  return o;
}

/** With probability `rate` per frame, one random joint teleports `magPx` in a random direction (low vis, like a mis-detection). */
export function injectOutliers(seq: Seq, rate: number, magPx: number, rng: () => number): Seq {
  const o = cloneSeq(seq);
  for (const p of o) {
    if (!p || rng() >= rate) continue;
    const ks = Object.keys(p);
    const k = ks[Math.floor(rng() * ks.length)];
    const a = rng() * Math.PI * 2;
    p[k].x += Math.cos(a) * magPx; p[k].y += Math.sin(a) * magPx; p[k].vis = 0.25;
  }
  return o;
}

/** Swap left/right of the given pairs on the given frames (limb-swap mis-detection). */
export function injectSwaps(seq: Seq, frames: number[], pairs: ReadonlyArray<readonly [string, string]>): Seq {
  const o = cloneSeq(seq);
  for (const f of frames) {
    const p = o[f];
    if (!p) continue;
    for (const [L, R] of pairs) { const t = p[L]; p[L] = p[R]; p[R] = t; }
  }
  return o;
}

export function dropFrames(seq: Seq, frames: number[]): Seq {
  const o = cloneSeq(seq);
  for (const f of frames) o[f] = null;
  return o;
}

/** Shift the track later by n frames (estimate lags truth). */
export function lagSeq(seq: Seq, n: number): Seq {
  const o = cloneSeq(seq);
  return o.map((_, i) => o[Math.max(0, i - n)]);
}

/** Centered box blur over every joint — a stand-in for "too much temporal smoothing". */
export function boxBlur(seq: Seq, half: number): Seq {
  return seq.map((_, i) => {
    const src = seq[i];
    if (!src) return null;
    const o: Pose = {};
    for (const k of Object.keys(src)) {
      let x = 0, y = 0, c = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(seq.length - 1, i + half); j++) {
        const q = seq[j]?.[k];
        if (q) { x += q.x; y += q.y; c++; }
      }
      o[k] = { x: x / c, y: y / c, vis: src[k].vis };
    }
    return o;
  });
}

import type { TrackSample } from '../trackSmoothing';
/** Seq ⇄ TrackSample (names kept), so the production track functions can run on synthetic tracks. */
export const toTrackSamples = (s: Seq, fps: number): TrackSample[] =>
  s.map((p, i) => ({ t: i / fps, kps: Object.entries(p!).map(([name, v]) => ({ name, x: v.x, y: v.y, score: v.vis ?? 0.9 })) }));
export const fromTrackSamples = (s: TrackSample[]): Seq =>
  s.map((x) => Object.fromEntries(x.kps.map((k) => [k.name, { x: k.x, y: k.y, vis: k.score }])));
