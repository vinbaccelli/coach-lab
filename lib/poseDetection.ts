'use client';

/**
 * Pose Detection module for Coach Lab.
 *
 * Real-time approach: run estimatePoses on the live video element during
 * normal playback, not pre-processing. This avoids frame-by-frame seeking
 * which is unreliable in browsers.
 */

// Deferred type imports to avoid loading TF.js at module parse time
type PoseDetector = import('@tensorflow-models/pose-detection').PoseDetector;
type Pose = import('@tensorflow-models/pose-detection').Pose;
type Keypoint = import('@tensorflow-models/pose-detection').Keypoint;

export interface CachedPoseFrame {
  frameIndex: number;
  timeSeconds: number;
  poses: Pose[];
}

export interface SkeletonFrame {
  timeSeconds: number;
  keypoints: Array<{ x: number; y: number; score: number; name: string }>;
}

// Singleton detector
let detector: PoseDetector | null = null;
let loading = false;
let loadPromise: Promise<PoseDetector | null> | null = null;

/** Load the MoveNet SINGLEPOSE_LIGHTNING detector (singleton, lazy). */
export async function getPoseDetector(): Promise<PoseDetector | null> {
  if (detector) return detector;
  if (loading && loadPromise) return loadPromise;
  if (typeof window === 'undefined') return null;

  loading = true;
  loadPromise = (async () => {
    try {
      const tf = await import('@tensorflow/tfjs-core');
      await import('@tensorflow/tfjs-backend-webgl');
      await import('@tensorflow/tfjs-converter');
      await tf.setBackend('webgl');
      await tf.ready();

      const pd = await import('@tensorflow-models/pose-detection');
      detector = await pd.createDetector(
        pd.SupportedModels.MoveNet,
        { modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING },
      );
      console.log('[PoseDetection] MoveNet Lightning loaded');
      return detector;
    } catch (err) {
      console.error('[PoseDetection] Load failed:', err);
      loading = false;
      loadPromise = null;
      return null;
    }
  })();

  return loadPromise;
}

/** Backward-compat alias */
export async function loadPoseModel(): Promise<PoseDetector> {
  const det = await getPoseDetector();
  if (!det) throw new Error('Pose model failed to load');
  return det;
}

/**
 * Detect pose on the current video frame (real-time, no seeking).
 * Returns keypoints or null if not ready.
 */
export async function detectPoseOnCurrentFrame(
  video: HTMLVideoElement,
): Promise<Array<{ x: number; y: number; score: number; name: string }> | null> {
  if (!detector) return null;
  if (video.readyState < 4) return null;
  if (video.videoWidth === 0) return null;

  try {
    const poses = await detector.estimatePoses(video, { flipHorizontal: false });
    if (poses && poses.length > 0 && poses[0].keypoints) {
      return poses[0].keypoints.map((kp) => ({
        x: kp.x,
        y: kp.y,
        score: kp.score ?? 0,
        name: kp.name ?? '',
      }));
    }
    return null;
  } catch (e) {
    console.warn('[PoseDetection] estimatePoses error:', e);
    return null;
  }
}

/** Run pose inference on a video element or image source. */
export async function estimatePoses(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<Pose[]> {
  const det = await loadPoseModel();
  return det.estimatePoses(source, { flipHorizontal: false });
}

// ── Skeleton rendering ─────────────────────────────────────────────────────

const POSE_COLOR = '#00E5FF';
const JOINT_RADIUS = 5;
const BONE_WIDTH = 2.5;
const RAD_TO_DEG = 180 / Math.PI;
const LABEL_OFFSET_X = 8;
const LABEL_OFFSET_Y = -8;
const LABEL_PAD_X = 2;
const LABEL_PAD_Y = 13;
const LABEL_LINE_HEIGHT = 16;

/** MoveNet SINGLEPOSE_LIGHTNING — 17 COCO keypoint names (index order) */
export const KEYPOINT_NAMES = [
  'nose',
  'left_eye', 'right_eye',
  'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
];

/** MoveNet bone connections (keypoint name pairs) */
const BONE_CONNECTIONS: [string, string][] = [
  ['nose', 'left_eye'], ['nose', 'right_eye'],
  ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];

function findKeypoint(kps: Keypoint[], name: string): Keypoint | undefined {
  return kps.find((k) => k.name === name);
}

/**
 * Draw a MoveNet skeleton on a 2D canvas context.
 */
export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  poses: Pose[],
  w: number,
  h: number,
  scaleX: number,
  scaleY: number,
  minScore = 0.4,
  userAdjustments?: Map<string, { x: number; y: number }>,
): void {
  if (!poses || poses.length === 0) return;

  const pose = poses[0];
  const kps = pose.keypoints;

  ctx.save();
  ctx.shadowColor = POSE_COLOR;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = POSE_COLOR;
  ctx.lineWidth = BONE_WIDTH;
  ctx.lineCap = 'round';

  const getCoords = (kp: Keypoint): { x: number; y: number } | null => {
    if (!kp || (kp.score ?? 0) < minScore) return null;
    const override = userAdjustments?.get(kp.name ?? '');
    if (override) return override;
    return { x: kp.x * scaleX, y: kp.y * scaleY };
  };

  for (const [nameA, nameB] of BONE_CONNECTIONS) {
    const kpA = findKeypoint(kps, nameA);
    const kpB = findKeypoint(kps, nameB);
    if (!kpA || !kpB) continue;
    const a = getCoords(kpA);
    const b = getCoords(kpB);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = POSE_COLOR;
  for (const kp of kps) {
    const coords = getCoords(kp);
    if (!coords) continue;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  const angleJoints = [
    { center: 'left_elbow',  ref1: 'left_shoulder',  ref2: 'left_wrist' },
    { center: 'right_elbow', ref1: 'right_shoulder', ref2: 'right_wrist' },
    { center: 'left_knee',   ref1: 'left_hip',       ref2: 'left_ankle' },
    { center: 'right_knee',  ref1: 'right_hip',      ref2: 'right_ankle' },
  ];

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.font = 'bold 12px Inter, sans-serif';

  for (const joint of angleJoints) {
    const kpC = findKeypoint(kps, joint.center);
    const kpA = findKeypoint(kps, joint.ref1);
    const kpB = findKeypoint(kps, joint.ref2);
    if (!kpC || !kpA || !kpB) continue;
    const c = getCoords(kpC);
    const a = getCoords(kpA);
    const b = getCoords(kpB);
    if (!c || !a || !b) continue;

    const v1 = { x: a.x - c.x, y: a.y - c.y };
    const v2 = { x: b.x - c.x, y: b.y - c.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
    if (mag === 0) continue;
    const angleDeg = Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * RAD_TO_DEG);

    const label = `${angleDeg}°`;
    const lx = c.x + LABEL_OFFSET_X;
    const ly = c.y + LABEL_OFFSET_Y;
    const metrics = ctx.measureText(label);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(lx - LABEL_PAD_X, ly - LABEL_PAD_Y, metrics.width + LABEL_PAD_X * 2, LABEL_LINE_HEIGHT);
    ctx.fillStyle = '#FFD700';
    ctx.fillText(label, lx, ly);
  }

  ctx.restore();
}

/**
 * Draw skeleton from a SkeletonFrame (real-time keypoints) on a canvas.
 * Scales keypoints from video native resolution to canvas display size.
 */
export function drawSkeletonFrame(
  ctx: CanvasRenderingContext2D,
  keypoints: Array<{ x: number; y: number; score: number; name: string }>,
  scaleX: number,
  scaleY: number,
  minScore = 0.4,
): void {
  if (!keypoints || keypoints.length === 0) return;

  ctx.save();
  ctx.shadowColor = POSE_COLOR;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = POSE_COLOR;
  ctx.lineWidth = BONE_WIDTH;
  ctx.lineCap = 'round';

  const kpMap = new Map(keypoints.map((kp) => [kp.name, kp]));

  const getCoords = (name: string): { x: number; y: number } | null => {
    const kp = kpMap.get(name);
    if (!kp || kp.score < minScore) return null;
    return { x: kp.x * scaleX, y: kp.y * scaleY };
  };

  for (const [nameA, nameB] of BONE_CONNECTIONS) {
    const a = getCoords(nameA);
    const b = getCoords(nameB);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = POSE_COLOR;
  for (const kp of keypoints) {
    if (kp.score < minScore) continue;
    ctx.beginPath();
    ctx.arc(kp.x * scaleX, kp.y * scaleY, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Pre-process all frames in a video, caching poses keyed by frame index.
 * Kept for backward compatibility.
 */
export async function processAllFrames(
  video: HTMLVideoElement,
  fps = 30,
  onProgress?: (p: number) => void,
): Promise<CachedPoseFrame[]> {
  const det = await loadPoseModel();
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return [];

  const totalFrames = Math.floor(duration * fps);
  const results: CachedPoseFrame[] = [];

  const DEFAULT_INFER_W = 640;
  const DEFAULT_INFER_H = 480;
  const inferScale = Math.min(1, DEFAULT_INFER_W / (video.videoWidth || DEFAULT_INFER_W));
  const inferW = Math.round((video.videoWidth  || DEFAULT_INFER_W) * inferScale);
  const inferH = Math.round((video.videoHeight || DEFAULT_INFER_H) * inferScale);
  const toVideoX = (video.videoWidth  || inferW) / inferW;
  const toVideoY = (video.videoHeight || inferH) / inferH;

  const offscreen = document.createElement('canvas');
  offscreen.width  = inferW;
  offscreen.height = inferH;
  const offCtx = offscreen.getContext('2d')!;

  const seekTo = (t: number): Promise<void> =>
    new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 1000);
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });

  const origTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    if (t >= duration) break;
    await seekTo(t);

    offCtx.drawImage(video, 0, 0, inferW, inferH);

    try {
      const poses = await det.estimatePoses(offscreen, { flipHorizontal: false });
      if (poses.length > 0) {
        type PoseType = typeof poses[0];
        const scaledPoses: PoseType[] = poses.map((pose) => ({
          ...pose,
          keypoints: pose.keypoints.map((kp) => ({
            ...kp,
            x: kp.x * toVideoX,
            y: kp.y * toVideoY,
          })),
        }));
        results.push({ frameIndex: f, timeSeconds: t, poses: scaledPoses });
      }
    } catch {
      // Ignore inference errors on individual frames
    }
    if (onProgress) onProgress((f + 1) / totalFrames);
    if (f % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  video.currentTime = origTime;
  if (!wasPaused) video.play().catch((err) => console.warn('[poseDetection] Could not resume video playback:', err));

  return results;
}

/**
 * Look up the cached pose frame closest to a given video time.
 */
export function getPoseAtTime(
  frames: CachedPoseFrame[],
  currentTime: number,
  fps = 30,
): CachedPoseFrame | null {
  if (frames.length === 0) return null;
  const targetFrame = Math.round(currentTime * fps);
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].frameIndex < targetFrame) lo = mid + 1;
    else hi = mid;
  }
  const candidate = frames[lo];
  if (Math.abs(candidate.frameIndex - targetFrame) <= 2) return candidate;
  return null;
}
