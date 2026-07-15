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

export type PoseModel = 'full' | 'heavy';

const MODEL_ASSET: Record<PoseModel, string> = {
  full: '/models/pose_landmarker_full.task',
  heavy: '/models/pose_landmarker_heavy.task',
};

// One cached landmarker per model. FULL (9.4MB) backs the live AI-Detect + the
// fast track tier; HEAVY (30MB) is lazily loaded only when the coach picks a
// more precise track speed.
const landmarkerPromises: Partial<Record<PoseModel, Promise<PoseLandmarkerT | null>>> = {};

export function preloadFeetDetector(): void {
  if (typeof window === 'undefined') return;
  void getLandmarker('full');
}

async function getLandmarker(model: PoseModel = 'full'): Promise<PoseLandmarkerT | null> {
  if (!landmarkerPromises[model]) {
    landmarkerPromises[model] = (async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
        const make = (delegate: 'GPU' | 'CPU') =>
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_ASSET[model], delegate },
            runningMode: 'IMAGE',
            numPoses: 1,
          });
        try {
          return await make('GPU');
        } catch {
          return await make('CPU');
        }
      } catch (e) {
        console.warn(`[mediapipePose] Pose Landmarker (${model}) unavailable:`, e);
        return null;
      }
    })();
  }
  return landmarkerPromises[model]!;
}

/** COCO-17 left/right slot pairs, for un-mirroring a flipped-frame detection. */
const LR_PAIRS: Array<[number, number]> = [
  [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
];
const FOOT_SWAP: Record<string, string> = {
  left_heel: 'right_heel',
  right_heel: 'left_heel',
  left_foot_index: 'right_foot_index',
  right_foot_index: 'left_foot_index',
};

/**
 * Map a Tasks-Vision landmark list → our COCO-17 + feet array, in video pixels.
 * When `flip` is set the source image was horizontally mirrored, so x is
 * un-flipped and anatomical left/right are swapped back to real orientation.
 */
function landmarksToKeypoints(
  pts: Array<{ x?: number; y?: number; visibility?: number }> | undefined,
  vw: number,
  vh: number,
  flip: boolean,
): PoseKeypoint[] | null {
  if (!pts || pts.length < 33) return null;
  const out: PoseKeypoint[] = COCO_FROM_MEDIAPIPE.map(({ mp, name }) => {
    const p = pts[mp];
    const x = (p?.x ?? 0) * vw;
    return { x: flip ? vw - x : x, y: (p?.y ?? 0) * vh, score: p ? (p.visibility ?? 0.5) : 0, name };
  });
  if (flip) {
    for (const [a, b] of LR_PAIRS) {
      const t = { x: out[a].x, y: out[a].y, score: out[a].score };
      out[a].x = out[b].x; out[a].y = out[b].y; out[a].score = out[b].score;
      out[b].x = t.x; out[b].y = t.y; out[b].score = t.score;
    }
  }
  for (const { mp, name } of FOOT_FROM_MEDIAPIPE) {
    const p = pts[mp];
    const score = p?.visibility ?? 0;
    if (p && score >= 0.3) {
      out.push({
        x: flip ? vw - (p.x ?? 0) * vw : (p.x ?? 0) * vw,
        y: (p.y ?? 0) * vh,
        score,
        name: flip ? FOOT_SWAP[name] : name,
      });
    }
  }
  // Reject junk detections: require a minimally-visible core body.
  const core = [5, 6, 11, 12].filter((i) => out[i].score >= 0.3).length;
  return core >= 2 ? out : null;
}

/**
 * Full 33-landmark detection on the CURRENT (paused) video frame, returned as
 * COCO-17 (MoveNet-compatible) + appended foot keypoints, in VIDEO PIXELS.
 * Returns null when the model is unavailable or no pose is found.
 */
export async function detectFullPoseOnFrame(video: HTMLVideoElement): Promise<PoseKeypoint[] | null> {
  if (!video || video.videoWidth < 16 || video.readyState < 2) return null;
  const lm = await getLandmarker('full');
  if (!lm) return null;
  try {
    return landmarksToKeypoints(lm.detect(video)?.landmarks?.[0], video.videoWidth, video.videoHeight, false);
  } catch (e) {
    console.warn('[mediapipePose] detect failed:', e);
    return null;
  }
}

// ── Precision AI Track quality tiers ───────────────────────────────────────
// The coach picks a "tracking speed" (0.1×–0.5×). Slower = more precise, mapped
// to a bigger model + test-time augmentation + denser frame sampling. Sampling
// HIGH is safe: redundant samples on low-fps footage collapse in smoothing,
// while high-fps footage keeps every fast-motion frame.
export type TrackQuality = 'fast' | 'balanced' | 'max';
export interface TrackParams {
  model: PoseModel;
  tta: boolean;
  fps: number;
  speedLabel: string;
}
export const TRACK_QUALITY: Record<TrackQuality, TrackParams> = {
  fast:     { model: 'full',  tta: false, fps: 30, speedLabel: '0.5×' },
  balanced: { model: 'heavy', tta: false, fps: 45, speedLabel: '0.25×' },
  max:      { model: 'heavy', tta: true,  fps: 60, speedLabel: '0.1×' },
};

/** Warm the landmarker for a chosen quality (so the popup's Start is snappy). */
export function preloadTrackModel(quality: TrackQuality): void {
  if (typeof window === 'undefined') return;
  void getLandmarker(TRACK_QUALITY[quality].model);
}

let flipScratch: HTMLCanvasElement | null = null;
function drawFlipped(video: HTMLVideoElement): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!flipScratch) flipScratch = document.createElement('canvas');
  if (flipScratch.width !== w) flipScratch.width = w;
  if (flipScratch.height !== h) flipScratch.height = h;
  const ctx = flipScratch.getContext('2d')!;
  ctx.setTransform(-1, 0, 0, 1, w, 0); // mirror horizontally
  ctx.drawImage(video, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return flipScratch;
}

/**
 * Precision detection on the current PAUSED frame for the bake pass. Uses the
 * tier's model, and — when `tta` is set — refines with a horizontally-flipped
 * pass (test-time augmentation) that removes per-frame bias. TTA only adjusts a
 * joint when the flipped estimate AGREES with the base (within 8% of frame
 * width); on disagreement the base wins, so augmentation can never drag a joint
 * off the athlete. Falls back to the FULL model if the tier model won't load.
 */
export async function detectPosePrecise(
  video: HTMLVideoElement,
  params: TrackParams,
): Promise<PoseKeypoint[] | null> {
  if (!video || video.videoWidth < 16 || video.readyState < 2) return null;
  const lm = (await getLandmarker(params.model)) ?? (await getLandmarker('full'));
  if (!lm) return null;

  let base: PoseKeypoint[] | null;
  try {
    base = landmarksToKeypoints(lm.detect(video)?.landmarks?.[0], video.videoWidth, video.videoHeight, false);
  } catch {
    return null;
  }
  if (!base || !params.tta) return base;

  let flip: PoseKeypoint[] | null = null;
  try {
    flip = landmarksToKeypoints(lm.detect(drawFlipped(video))?.landmarks?.[0], video.videoWidth, video.videoHeight, true);
  } catch {
    flip = null;
  }
  if (!flip) return base;

  const AGREE = video.videoWidth * 0.08;
  const byName = new Map(flip.map((k) => [k.name, k]));
  return base.map((ka) => {
    const kb = byName.get(ka.name);
    if (!kb) return ka;
    if (Math.hypot(ka.x - kb.x, ka.y - kb.y) > AGREE) return ka;
    const w = ka.score + kb.score;
    if (w <= 0) return ka;
    return {
      name: ka.name,
      x: (ka.x * ka.score + kb.x * kb.score) / w,
      y: (ka.y * ka.score + kb.y * kb.score) / w,
      score: Math.max(ka.score, kb.score),
    };
  });
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
