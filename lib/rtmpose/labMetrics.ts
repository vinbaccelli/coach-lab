/**
 * RTMPose spike — metrics for comparing pose engines on the SAME frames (pure, no DOM).
 * No ground truth exists for real clips: "reference" metrics compare against a slow, high-accuracy engine
 * (MediaPipe heavy, crop-tracked = the AI Track quality) and are PSEUDO-truth, not truth.
 */
import { bodyHeight, trackStats, crossClassJumps, type Seq, type TrackStats, type CrossClass } from '../skeletonBench/metrics';
import { validateTrack, type ValidationReport } from '../skeletonValidate';
import type { Kp } from './core';

export interface LabFrame { t: number; kps: Kp[] | null; ms: number }

const pctile = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const round = (n: number, d = 3) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

export function toSeq(frames: LabFrame[], minScore: number): Seq {
  return frames.map((f) => {
    if (!f.kps) return null;
    const p: Record<string, { x: number; y: number; vis: number }> = {};
    for (const k of f.kps) if (k.score >= minScore) p[k.name] = { x: k.x, y: k.y, vis: k.score };
    return Object.keys(p).length ? p : null;
  });
}

/** Peak wrist speed in body-heights per second (max of both wrists), consecutive detected frames only. */
export function peakWristSpeed(frames: LabFrame[], seq: Seq): number {
  const H = bodyHeight(seq);
  if (!(H > 0)) return NaN;
  let peak = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = seq[i - 1], b = seq[i];
    const dt = frames[i].t - frames[i - 1].t;
    if (!a || !b || !(dt > 0)) continue;
    for (const n of ['left_wrist', 'right_wrist']) {
      if (a[n] && b[n]) peak = Math.max(peak, Math.hypot(b[n].x - a[n].x, b[n].y - a[n].y) / H / dt);
    }
  }
  return peak;
}

export interface EngineSummary {
  frames: number;
  detectedPct: number;
  msP50: number | null; msP95: number | null; msMax: number | null;
  /** Sequential pipeline throughput (1000 / mean ms): what the engine could sustain with nothing else running. */
  fpsSustained: number | null;
  track: TrackStats;
  crossLimb: CrossClass;
  validation: ValidationReport;
  peakWristBhPerS: number | null;
}

export function summarize(frames: LabFrame[], minScore = 0.3): EngineSummary {
  const seq = toSeq(frames, minScore);
  const ms = frames.filter((f) => f.ms > 0).map((f) => f.ms);
  const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : NaN;
  const samples = frames.filter((f) => f.kps).map((f) => ({ t: f.t, kps: f.kps! }));
  const { report } = validateTrack(samples);
  return {
    frames: frames.length,
    detectedPct: frames.length ? Math.round((100 * frames.filter((f) => f.kps).length) / frames.length) : 0,
    msP50: round(pctile(ms, 0.5), 1), msP95: round(pctile(ms, 0.95), 1), msMax: round(Math.max(...ms), 1),
    fpsSustained: round(1000 / mean, 1),
    track: trackStats(seq, { minScore }),
    crossLimb: crossClassJumps(seq, minScore),
    validation: report,
    peakWristBhPerS: round(peakWristSpeed(frames, seq), 2),
  };
}

export interface RefComparison {
  /** Frames where both engines have a pose. */
  n: number;
  /** Mean joint distance to the reference, in reference body heights (lower = closer). */
  meanErrBh: number | null;
  /** Share of joints within 0.1 reference body heights (PCK@0.1). */
  pck10: number | null;
  armErrBh: number | null; legErrBh: number | null; wristErrBh: number | null;
  /** Peak wrist speed ÷ reference peak wrist speed (1 = preserved, < 1 = swing speed lost, > 1 = jittery). */
  wristSpeedRatio: number | null;
}

const ARM = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'];
const LEG = ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

export function compareToReference(est: LabFrame[], ref: LabFrame[], minScore = 0.3): RefComparison {
  const n = Math.min(est.length, ref.length);
  const rs = toSeq(ref, minScore), es = toSeq(est, minScore);
  const H = bodyHeight(rs);
  const all: number[] = [], arm: number[] = [], leg: number[] = [], wr: number[] = [];
  let frames = 0;
  for (let i = 0; i < n; i++) {
    const a = es[i], b = rs[i];
    if (!a || !b || !(H > 0)) continue;
    frames++;
    for (const j of [...ARM, ...LEG]) {
      if (!a[j] || !b[j]) continue;
      const e = Math.hypot(a[j].x - b[j].x, a[j].y - b[j].y) / H;
      all.push(e);
      if (ARM.includes(j)) arm.push(e); else leg.push(e);
      if (j.endsWith('wrist')) wr.push(e);
    }
  }
  const mean = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);
  const ep = peakWristSpeed(est.slice(0, n), es), rp = peakWristSpeed(ref.slice(0, n), rs);
  return {
    n: frames,
    meanErrBh: round(mean(all)), pck10: all.length ? round(all.filter((e) => e < 0.1).length / all.length) : null,
    armErrBh: round(mean(arm)), legErrBh: round(mean(leg)), wristErrBh: round(mean(wr)),
    wristSpeedRatio: rp > 0 ? round(ep / rp, 2) : null,
  };
}
