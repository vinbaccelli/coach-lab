'use client';

/**
 * Offline smoothing for Precision-AI-Track pose tracks.
 *
 * Live tracking can only ever smooth CAUSALLY (it can't see the future), which
 * forces a jitter-vs-lag tradeoff. A baked track has every sample up front, so
 * we can do what live never can:
 *
 *   1. OUTLIER REPAIR — rolling median (window 5) per joint channel; a sample
 *      deviating > max(3×MAD, 3 px) from the local median is a mis-detection
 *      (limb swap, background lock) and is replaced by the median.
 *   2. ZERO-LAG SMOOTHING — centered Gaussian (window ±3, σ ≈ 1.2 samples),
 *      confidence-weighted so low-score detections pull less. Centered ⇒ no
 *      phase lag: the smoothed joint stays ON the athlete through the swing.
 *
 * Channels are aligned BY KEYPOINT NAME, because appended foot keypoints
 * (indices 17+) exist only on frames where MediaPipe saw the foot — gaps stay
 * gaps (we never fabricate a foot), and smoothing windows simply skip them.
 */

export type TrackKeypoint = { x: number; y: number; score: number; name: string };
export type TrackSample = { t: number; kps: TrackKeypoint[] };

const MEDIAN_WINDOW = 5;          // outlier-repair window (samples)
const OUTLIER_MAD_FACTOR = 3;
const OUTLIER_MIN_PX = 3;         // MAD floor so still joints aren't over-flagged
const GAUSS_HALF_WINDOW = 3;      // centered smoothing: ±3 samples
const GAUSS_SIGMA = 1.2;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One channel = one joint's x or y series (with gaps where the joint is absent). */
function repairAndSmoothChannel(
  values: Array<number | null>,
  scores: Array<number>,
): Array<number | null> {
  const n = values.length;

  // ── 1. Outlier repair via rolling median ────────────────────────────────
  const repaired: Array<number | null> = [...values];
  const half = MEDIAN_WINDOW >> 1;
  for (let i = 0; i < n; i++) {
    if (values[i] == null) continue;
    const win: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      const v = values[j];
      if (v != null) win.push(v);
    }
    if (win.length < 3) continue;
    const med = median(win);
    const mad = median(win.map((v) => Math.abs(v - med)));
    const limit = Math.max(OUTLIER_MAD_FACTOR * mad, OUTLIER_MIN_PX);
    if (Math.abs((values[i] as number) - med) > limit) repaired[i] = med;
  }

  // ── 2. Centered, confidence-weighted Gaussian ───────────────────────────
  const out: Array<number | null> = new Array(n).fill(null);
  const gw: number[] = [];
  for (let k = -GAUSS_HALF_WINDOW; k <= GAUSS_HALF_WINDOW; k++) {
    gw.push(Math.exp(-(k * k) / (2 * GAUSS_SIGMA * GAUSS_SIGMA)));
  }
  for (let i = 0; i < n; i++) {
    if (repaired[i] == null) continue;
    let acc = 0;
    let wsum = 0;
    for (let k = -GAUSS_HALF_WINDOW; k <= GAUSS_HALF_WINDOW; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const v = repaired[j];
      if (v == null) continue;
      const w = gw[k + GAUSS_HALF_WINDOW] * Math.max(0.05, scores[j] ?? 0.5);
      acc += v * w;
      wsum += w;
    }
    out[i] = wsum > 0 ? acc / wsum : repaired[i];
  }
  return out;
}

/**
 * Smooth a baked track in place-safe fashion (returns new samples; input
 * untouched). Samples must be sorted by t (finishBakeCapture guarantees it).
 */
export function smoothBakedTrack(samples: TrackSample[]): TrackSample[] {
  if (samples.length < MEDIAN_WINDOW) return samples;

  // Collect every keypoint name present anywhere in the track.
  const names = new Set<string>();
  for (const s of samples) for (const k of s.kps) if (k.name) names.add(k.name);

  // Deep-copy output skeleton.
  const out: TrackSample[] = samples.map((s) => ({ t: s.t, kps: s.kps.map((k) => ({ ...k })) }));

  for (const name of names) {
    // Per-sample position of this joint (index within each kps array), or null.
    const idxAt: Array<number | null> = samples.map((s) => {
      const i = s.kps.findIndex((k) => k.name === name);
      return i >= 0 ? i : null;
    });
    const xs: Array<number | null> = samples.map((s, si) => (idxAt[si] != null ? s.kps[idxAt[si] as number].x : null));
    const ys: Array<number | null> = samples.map((s, si) => (idxAt[si] != null ? s.kps[idxAt[si] as number].y : null));
    const scores: number[] = samples.map((s, si) => (idxAt[si] != null ? s.kps[idxAt[si] as number].score : 0));

    const sx = repairAndSmoothChannel(xs, scores);
    const sy = repairAndSmoothChannel(ys, scores);

    for (let si = 0; si < samples.length; si++) {
      const ki = idxAt[si];
      if (ki == null) continue;
      const nx = sx[si];
      const ny = sy[si];
      if (nx != null) out[si].kps[ki].x = nx;
      if (ny != null) out[si].kps[ki].y = ny;
    }
  }
  return out;
}
