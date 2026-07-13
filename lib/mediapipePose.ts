'use client';

/**
 * MediaPipe Pose Landmarker (33 landmarks, incl. real heel + toe) for the
 * NON-latency-critical paths:
 *   1. the frame-stepped Precision AI Track pass (full pose per frame)
 *   2. the one-shot AI Detect enrichment on a paused frame
 * The realtime skeleton stays on MoveNet (worker) — this module never runs
 * during live playback.
 *
 * One landmarker instance in IMAGE runningMode: the callers always operate on
 * a PAUSED, seeked frame, so IMAGE mode is correct and sidesteps VIDEO mode's
 * monotonic-timestamp requirement entirely.
 *
 * Output convention: MoveNet-compatible COCO-17 array (same indices/names all
 * existing consumers assume) + the four real foot keypoints APPENDED at
 * indices 17+ as named entries (left_heel, right_heel, left_foot_index,
 * right_foot_index). Consumers look feet up by name.
 *
 * Assets are self-hosted (no CDN a blocker could kill):
 *   /mediapipe-wasm/*  (copied from @mediapipe/tasks-vision)
 *   /models/pose_landmarker_full.task
 */

export type PoseKeypoint = { x: number; y: number; score: number; name: string };

export interface FootPoints {
  left_heel?: { x: number; y: number; score: number };
  right_heel?: { x: number; y: number; score: number };
  left_foot_index?: { x: number; y: number; score: number };
  right_foot_index?: { x: number; y: number; score: number };
}

/** BlazePose/Tasks landmark index → COCO-17 slot (MoveNet order + names). */
const COCO_FROM_MEDIAPIPE: Array<{ mp: number; name: string }> = [
  { mp: 0, name: 'nose' },
  { mp: 2, name: 'left_eye' },
  { mp: 5, name: 'right_eye' },
  { mp: 7, name: 'left_ear' },
  { mp: 8, name: 'right_ear' },
  { mp: 11, name: 'left_shoulder' },
  { mp: 12, name: 'right_shoulder' },
  { mp: 13, name: 'left_elbow' },
  { mp: 14, name: 'right_elbow' },
  { mp: 15, name: 'left_wrist' },
  { mp: 16, name: 'right_wrist' },
  { mp: 23, name: 'left_hip' },
  { mp: 24, name: 'right_hip' },
  { mp: 25, name: 'left_knee' },
  { mp: 26, name: 'right_knee' },
  { mp: 27, name: 'left_ankle' },
  { mp: 28, name: 'right_ankle' },
];

const FOOT_FROM_MEDIAPIPE: Array<{ mp: number; name: keyof FootPoints }> = [
  { mp: 29, name: 'left_heel' },
  { mp: 30, name: 'right_heel' },
  { mp: 31, name: 'left_foot_index' },
  { mp: 32, name: 'right_foot_index' },
];

type PoseLandmarkerT = import('@mediapipe/tasks-vision').PoseLandmarker;

let landmarkerPromise: Promise<PoseLandmarkerT | null> | null = null;

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
            runningMode: 'IMAGE',
            numPoses: 1,
          });
        try {
          return await make('GPU');
        } catch {
          return await make('CPU');
        }
      } catch (e) {
        console.warn('[mediapipePose] Pose Landmarker unavailable:', e);
        return null;
      }
    })();
  }
  return landmarkerPromise;
}

/**
 * Full 33-landmark detection on the CURRENT (paused) video frame, returned as
 * COCO-17 (MoveNet-compatible) + appended foot keypoints, in VIDEO PIXELS.
 * Returns null when the model is unavailable or no pose is found.
 */
export async function detectFullPoseOnFrame(video: HTMLVideoElement): Promise<PoseKeypoint[] | null> {
  if (!video || video.videoWidth < 16 || video.readyState < 2) return null;
  const lm = await getLandmarker();
  if (!lm) return null;

  try {
    const res = lm.detect(video);
    const pts = res?.landmarks?.[0];
    if (!pts || pts.length < 33) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const out: PoseKeypoint[] = COCO_FROM_MEDIAPIPE.map(({ mp, name }) => {
      const p = pts[mp];
      return {
        x: (p?.x ?? 0) * vw,
        y: (p?.y ?? 0) * vh,
        score: p ? (p.visibility ?? 0.5) : 0,
        name,
      };
    });
    for (const { mp, name } of FOOT_FROM_MEDIAPIPE) {
      const p = pts[mp];
      const score = p?.visibility ?? 0;
      if (p && score >= 0.3) out.push({ x: p.x * vw, y: p.y * vh, score, name });
    }
    // Reject junk detections: require a minimally-visible core body.
    const core = [5, 6, 11, 12].filter((i) => out[i].score >= 0.3).length;
    return core >= 2 ? out : null;
  } catch (e) {
    console.warn('[mediapipePose] detect failed:', e);
    return null;
  }
}

/** Foot landmarks only (video pixels) — thin wrapper over the full detection. */
export async function detectFeetOnFrame(video: HTMLVideoElement): Promise<FootPoints | null> {
  const kps = await detectFullPoseOnFrame(video);
  if (!kps) return null;
  const out: FootPoints = {};
  for (let i = 17; i < kps.length; i++) {
    const k = kps[i];
    if (k.name === 'left_heel' || k.name === 'right_heel' || k.name === 'left_foot_index' || k.name === 'right_foot_index') {
      out[k.name as keyof FootPoints] = { x: k.x, y: k.y, score: k.score };
    }
  }
  return out.left_foot_index || out.right_foot_index ? out : null;
}

/** Convert FootPoints into named keypoint entries for appending to a pose array. */
export function footPointsToKeypoints(fp: FootPoints): PoseKeypoint[] {
  const out: PoseKeypoint[] = [];
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
