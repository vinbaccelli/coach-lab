'use client';

/**
 * Real foot keypoints (heel + toe) via MediaPipe Pose Landmarker (33 landmarks).
 *
 * MoveNet — the live skeleton engine — has NO toe/heel keypoints, so the foot
 * line could only ever be estimated. This module runs the heavier MediaPipe
 * model in the two places that are NOT latency-critical:
 *   1. during the Precision AI Track slow pass (feet get baked into the track)
 *   2. on the paused frame when AI Detect runs
 * The realtime MoveNet path stays untouched — zero risk to live tracking.
 *
 * Assets are self-hosted (no CDN a blocker could kill):
 *   /mediapipe-wasm/*  (copied from @mediapipe/tasks-vision)
 *   /models/pose_landmarker_full.task
 */

export interface FootPoints {
  /** Video-pixel coords; score = landmark visibility. */
  left_heel?: { x: number; y: number; score: number };
  right_heel?: { x: number; y: number; score: number };
  left_foot_index?: { x: number; y: number; score: number };
  right_foot_index?: { x: number; y: number; score: number };
}

/** Named keypoint entries appended to a MoveNet-17 array (indices 17+). */
export type AppendedFootKeypoint = { x: number; y: number; score: number; name: string };

// BlazePose/Tasks landmark indices.
const IDX = { left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32 } as const;

type PoseLandmarkerT = import('@mediapipe/tasks-vision').PoseLandmarker;

let landmarkerPromise: Promise<PoseLandmarkerT | null> | null = null;
let lastVideoTs = 0;

export function preloadFeetDetector(): void {
  if (typeof window === 'undefined') return;
  void getLandmarker();
}

async function getLandmarker(): Promise<PoseLandmarkerT | null> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
        const make = (delegate: 'GPU' | 'CPU') =>
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
          });
        try {
          return await make('GPU');
        } catch {
          return await make('CPU');
        }
      } catch (e) {
        console.warn('[mediapipeFeet] Pose Landmarker unavailable:', e);
        return null;
      }
    })();
  }
  return landmarkerPromise;
}

/**
 * Detect the four foot landmarks on the CURRENT video frame.
 * Returns video-pixel coords, or null when the model/detection is unavailable.
 */
export async function detectFeetOnFrame(video: HTMLVideoElement): Promise<FootPoints | null> {
  if (!video || video.videoWidth < 16 || video.readyState < 2) return null;
  const lm = await getLandmarker();
  if (!lm) return null;

  // detectForVideo requires strictly increasing timestamps.
  let ts = performance.now();
  if (ts <= lastVideoTs) ts = lastVideoTs + 0.01;
  lastVideoTs = ts;

  try {
    const res = lm.detectForVideo(video, ts);
    const pts = res?.landmarks?.[0];
    if (!pts || pts.length < 33) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const pick = (i: number) => {
      const p = pts[i];
      if (!p) return undefined;
      const score = p.visibility ?? 0.5;
      if (score < 0.3) return undefined;
      return { x: p.x * vw, y: p.y * vh, score };
    };
    const out: FootPoints = {
      left_heel: pick(IDX.left_heel),
      right_heel: pick(IDX.right_heel),
      left_foot_index: pick(IDX.left_foot_index),
      right_foot_index: pick(IDX.right_foot_index),
    };
    return out.left_foot_index || out.right_foot_index ? out : null;
  } catch (e) {
    console.warn('[mediapipeFeet] detect failed:', e);
    return null;
  }
}

/** Convert FootPoints into named keypoint entries for appending to a pose array. */
export function footPointsToKeypoints(fp: FootPoints): AppendedFootKeypoint[] {
  const out: AppendedFootKeypoint[] = [];
  for (const name of ['left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'] as const) {
    const p = fp[name];
    if (p) out.push({ x: p.x, y: p.y, score: p.score, name });
  }
  return out;
}

/** Find an appended foot keypoint by name in a pose array (17 MoveNet + extras). */
export function findFootKeypoint(
  kps: Array<{ x: number; y: number; score: number; name?: string }> | null | undefined,
  name: 'left_heel' | 'right_heel' | 'left_foot_index' | 'right_foot_index',
  minScore = 0.3,
): { x: number; y: number; score: number } | null {
  if (!kps) return null;
  for (let i = 17; i < kps.length; i++) {
    const k = kps[i];
    if (k?.name === name && k.score >= minScore) return k;
  }
  return null;
}
