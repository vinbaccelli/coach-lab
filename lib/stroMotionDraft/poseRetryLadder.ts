'use client';

/**
 * POSE RETRY LADDER — recover a joint the default pose pass dropped, on ONE frame.
 *
 * ── THE THING THAT IS NOT TRUE, AND WHY IT MATTERS ────────────────────────
 * The obvious design is "let the coach click Redo mask again and re-roll the
 * pose". That cannot work here, and it is worth stating plainly so nobody builds
 * it twice: `mediapipePose` runs its landmarker in `runningMode: 'IMAGE'`, and
 * `lm.detect()` is a STATELESS forward pass. Identical pixels in ⇒ bit-identical
 * landmarks out. The frame is re-captured from the same `timeSec`, so the pixels
 * ARE identical. Clicking Redo mask ten times therefore produces the same twenty
 * joints ten times — there is no randomness to re-roll.
 *
 * A dropped joint is not bad luck; it is that model, on those pixels, at that
 * threshold. Getting a different answer requires DIFFERENT COMPUTATION.
 *
 * ── WHAT ACTUALLY RECOVERS A JOINT ────────────────────────────────────────
 * Two levers, both already proven in this codebase by `detectPosePrecise`'s
 * Precision AI Track tiers, applied here to a single frame:
 *
 *   FLIP  — mirroring cancels the model's own left/right bias. That bias is
 *           exactly what drops the FAR arm on a side-on stance, because the far
 *           arm is the occluded one. A mirrored frame presents it as the near arm.
 *   HEAVY — the larger landmarker resolves detail `full` misses. Its latency is
 *           irrelevant for a one-frame action the coach explicitly asked for.
 *
 * So one Redo-mask click now tries four genuinely different computations and
 * KEEPS THE BEST, rather than asking the coach to click hopefully. It is
 * deterministic: the same frame gives the same (best) answer every time, which is
 * the correct behaviour — a second click confirming the first is information, not
 * a wasted roll.
 *
 * ── HOW "BEST" IS DECIDED ─────────────────────────────────────────────────
 * By the number of joints that clear the repo-wide visibility gate, because that
 * is precisely what every downstream consumer counts: the zone builds capsules
 * only from gated joints, and the debug overlay's `joints=` is the same measure.
 * A pose with more gated joints is a pose with more limbs the zone can cover.
 *
 * Ties keep the EARLIER attempt, so the plain `full` pass wins unless a heavier
 * or mirrored one genuinely finds more. Augmentation can therefore never make a
 * good frame worse — it can only add.
 */

import { detectPoseAttemptOnBitmap, type PoseKeypoint } from '@/lib/mediapipePose';

/**
 * Repo-wide joint visibility gate — matches `MIN_POSE_SCORE` (stroMotionPose) and
 * `MIN_SCORE` (skeletonMaskFilter). Counting on the same threshold the zone uses
 * is what makes "more joints" mean "more limbs the zone can actually cover".
 */
const POSE_GATE = 0.2;

interface Attempt {
  label: string;
  model: 'full' | 'heavy';
  flip: boolean;
}

/**
 * Ordered cheapest-first. The plain `full` pass is attempt 0 so an easy frame
 * costs exactly what it always did and wins on a tie.
 */
const LADDER: Attempt[] = [
  { label: 'full',        model: 'full',  flip: false },
  { label: 'full+flip',   model: 'full',  flip: true  },
  { label: 'heavy',       model: 'heavy', flip: false },
  { label: 'heavy+flip',  model: 'heavy', flip: true  },
];

export interface PoseLadderResult {
  /** The winning attempt's keypoints, in VIDEO PIXELS (not normalized). */
  keypoints: PoseKeypoint[];
  /** Which attempt won. */
  winner: string;
  /** Gated joint count for the winner, and for every attempt, for the log. */
  gated: number;
  attempts: Array<{ label: string; gated: number; total: number; ms: number }>;
}

function gatedCount(kps: PoseKeypoint[] | null): number {
  if (!kps) return 0;
  let n = 0;
  for (const k of kps) if (k.score >= POSE_GATE) n++;
  return n;
}

/**
 * Run the ladder on one frame and return the attempt with the most gated joints.
 *
 * `stopAt` short-circuits: once an attempt reaches this many gated joints there is
 * nothing left to recover, so the remaining (slower) attempts are skipped. 21 =
 * COCO-17 + four feet, the full set this pipeline can express.
 *
 * Returns null only when EVERY attempt failed to produce a pose at all.
 */
export async function detectBestPoseOnBitmap(
  src: ImageBitmap | HTMLCanvasElement,
  vw: number,
  vh: number,
  opts: { stopAt?: number; label?: string } = {},
): Promise<PoseLadderResult | null> {
  const stopAt = opts.stopAt ?? 21;
  const tag = opts.label ? `${opts.label} ` : '';

  let best: PoseKeypoint[] | null = null;
  let bestGated = -1;
  let bestLabel = 'none';
  const attempts: PoseLadderResult['attempts'] = [];

  for (const a of LADDER) {
    const t0 = performance.now();
    let kps: PoseKeypoint[] | null = null;
    try {
      kps = await detectPoseAttemptOnBitmap(src, vw, vh, { model: a.model, flip: a.flip });
    } catch (e) {
      console.warn(`[redoMask] attempt ${a.label} threw:`, e);
    }
    const ms = performance.now() - t0;
    const g = gatedCount(kps);
    attempts.push({ label: a.label, gated: g, total: kps?.length ?? 0, ms: Math.round(ms) });
    console.log(
      `[redoMask] ${tag}pose attempt ${a.label}: joints=${g}/${kps?.length ?? 0} gated ` +
      `(${ms.toFixed(0)}ms)${g > bestGated ? ' ← best so far' : ''}`,
    );
    // Strictly greater, so a tie keeps the earlier (cheaper, unaugmented) attempt.
    if (kps && g > bestGated) {
      best = kps;
      bestGated = g;
      bestLabel = a.label;
    }
    if (bestGated >= stopAt) break;
  }

  if (!best) {
    console.warn(`[redoMask] ${tag}no attempt produced a pose`);
    return null;
  }
  console.log(
    `[redoMask] ${tag}WINNER "${bestLabel}" with ${bestGated} gated joints ` +
    `(${attempts.map((a) => `${a.label}:${a.gated}`).join(' ')})`,
  );
  return { keypoints: best, winner: bestLabel, gated: bestGated, attempts };
}
