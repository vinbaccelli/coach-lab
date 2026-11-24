/**
 * Live skeleton display (AI Track OFF): which pose to draw between detections.
 *
 * The old display INTERPOLATED prev → latest, which by construction shows a pose
 * one whole detection interval older than the newest one on top of the inference
 * latency itself: measured in the live-path model (lib/skeletonBench/liveSim.ts)
 * the skeleton trailed the player by ≈ 2 × inference time (85 / 165 / 305 ms at
 * 40 / 80 / 150 ms inference).
 *
 * This instead CONTINUES the motion from the newest detection using the velocity
 * of the last two (already One-Euro-smoothed) detections, for as long as that
 * detection has been on screen, bounded to 1.25 detection intervals and 150 ms.
 * It does NOT try to cancel the inference latency itself (compensating it fully
 * overshoots on a decelerating swing: measured higher error and max error).
 */
export interface LiveKp { x: number; y: number; score: number; name: string }
export interface LiveSample { kps: LiveKp[]; ts: number }

export const CONTINUE_CAP_MS = 150;
export const CONTINUE_MAX_INTERVALS = 1.25;
const MIN_SCORE = 0.2;
/** A joint is only extrapolated once its per-interval step clearly exceeds detection noise: dead zone = this × body height, ramping to full effect at twice that. Without it a still player's noise is amplified (measured σ 2.2 → 3.9 px). */
const DEADBAND_BH = 0.012;
const BODY_JOINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

function bodyHeightPx(kps: readonly LiveKp[]): number {
  const ys = kps.filter((k) => BODY_JOINTS.includes(k.name) && k.score >= MIN_SCORE).map((k) => k.y);
  return ys.length >= 4 ? Math.max(...ys) - Math.min(...ys) : 0;
}

export function continuePose(latest: LiveSample, prev: LiveSample, nowMs: number): LiveKp[] {
  if (latest.kps.length !== prev.kps.length) return latest.kps;
  const dt = Math.max(1, latest.ts - prev.ts);
  const age = Math.max(0, nowMs - latest.ts);
  const horizon = Math.min(age, CONTINUE_MAX_INTERVALS * dt, CONTINUE_CAP_MS);
  if (horizon <= 0) return latest.kps;
  const dead = DEADBAND_BH * (bodyHeightPx(latest.kps) || 400);
  const a = Math.min(1, age / dt); // legacy blend: 0 → previous sample, 1 → latest
  return latest.kps.map((k, i) => {
    const p = prev.kps[i];
    if (!p || k.score < MIN_SCORE || p.score < MIN_SCORE || p.name !== k.name) return k;
    const step = Math.hypot(k.x - p.x, k.y - p.y);
    // f: 0 inside the noise floor → smooth interpolation (no jitter amplification, no stair-stepping, lag is a few px there);
    //    1 from 2× the floor → continue the motion (the part that removes the extra detection interval of lag).
    const f = Math.min(1, Math.max(0, (step - dead) / dead));
    const ix = p.x + (k.x - p.x) * a, iy = p.y + (k.y - p.y) * a;
    const cx = k.x + ((k.x - p.x) / dt) * horizon, cy = k.y + ((k.y - p.y) / dt) * horizon;
    return { ...k, x: ix + (cx - ix) * f, y: iy + (cy - iy) * f };
  });
}
