/**
 * Pose Detection module for Coach Lab.
 *
 * Uses MoveNet SINGLEPOSE_LIGHTNING via @tensorflow-models/pose-detection.
 * Loads lazily to avoid including the large TensorFlow.js bundle in the initial page load.
 *
 * Key exports:
 *   loadPoseModel()       — Loads and caches the MoveNet model.
 *   estimatePoses()       — Runs inference on a video/canvas element.
 *   drawPoseSkeleton()    — Renders keypoints + bone connections on a canvas.
 *   processAllFrames()    — Pre-processes all video frames and caches results.
 *   getPoseAtTime()       — O(1) lookup of cached pose for the current time.
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

// Singleton detector
let detector: PoseDetector | null = null;
let detectorLoadPromise: Promise<PoseDetector> | null = null;

/** Load the MoveNet SINGLEPOSE_LIGHTNING detector (singleton). Resolves quickly on subsequent calls. */
export async function loadPoseModel(): Promise<PoseDetector> {
  if (detector) return detector;
  if (detectorLoadPromise) return detectorLoadPromise;

  detectorLoadPromise = (async () => {
    // Server-side guard — TF.js WebGL backend cannot run during SSR
    if (typeof window === 'undefined') {
      throw new Error('TensorFlow.js cannot run on server');
    }

    // Dynamic imports so TF.js is only bundled when this function is called.
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-webgl');
    await tf.ready();

    const poseDetection = await import('@tensorflow-models/pose-detection');

    // MoveNet SINGLEPOSE_LIGHTNING: ~15–20 ms/frame, 17 COCO keypoints
    const model = poseDetection.SupportedModels.MoveNet;
    const det = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    });

    detector = det;
    return det;
  })();

  return detectorLoadPromise;
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
// Pixel offset for angle labels relative to the joint dot
const LABEL_OFFSET_X = 8;
const LABEL_OFFSET_Y = -8;
// Background rectangle padding/height for angle labels
const LABEL_PAD_X = 2;
const LABEL_PAD_Y = 13;
const LABEL_LINE_HEIGHT = 16;

/** MoveNet SINGLEPOSE_LIGHTNING — 17 COCO keypoint names (index order) */
const KEYPOINT_NAMES = [
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
  // Head
  ['nose', 'left_eye'],
  ['nose', 'right_eye'],
  ['left_eye', 'left_ear'],
  ['right_eye', 'right_ear'],
  // Upper body
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  // Torso
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  // Legs
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

function findKeypoint(kps: Keypoint[], name: string): Keypoint | undefined {
  return kps.find((k) => k.name === name);
}

/**
 * Draw a MoveNet skeleton on a 2D canvas context.
 *
 * @param ctx      2D rendering context.
 * @param poses    Array of poses from estimatePoses().
 * @param w        Canvas pixel width.
 * @param h        Canvas pixel height.
 * @param scaleX   Horizontal scale: displayWidth / video.videoWidth
 * @param scaleY   Vertical scale: displayHeight / video.videoHeight
 * @param minScore Minimum confidence to render a keypoint (0–1).
 * @param userAdjustments Optional map of keypoint name → {x,y} pixel overrides.
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

  // Helper: get pixel coords for a keypoint (with optional user override)
  const getCoords = (kp: Keypoint): { x: number; y: number } | null => {
    if (!kp || (kp.score ?? 0) < minScore) return null;
    const override = userAdjustments?.get(kp.name ?? '');
    if (override) return override;
    return { x: kp.x * scaleX, y: kp.y * scaleY };
  };

  // Draw bones
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

  // Draw joints
  ctx.fillStyle = POSE_COLOR;
  for (const kp of kps) {
    const coords = getCoords(kp);
    if (!coords) continue;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw joint angle labels for key joints
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

    // Compute angle at vertex c between vectors c→a and c→b
    const v1 = { x: a.x - c.x, y: a.y - c.y };
    const v2 = { x: b.x - c.x, y: b.y - c.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
    if (mag === 0) continue;
    const angleDeg = Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * RAD_TO_DEG);

    const label = `${angleDeg}°`;
    const lx = c.x + LABEL_OFFSET_X;
    const ly = c.y + LABEL_OFFSET_Y;
    // Dark background for readability
    const metrics = ctx.measureText(label);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(lx - LABEL_PAD_X, ly - LABEL_PAD_Y, metrics.width + LABEL_PAD_X * 2, LABEL_LINE_HEIGHT);
    ctx.fillStyle = '#FFD700';
    ctx.fillText(label, lx, ly);
  }

  ctx.restore();
}

/**
 * Pre-process all frames in a video, caching poses keyed by frame index.
 *
 * Draws each video frame to an offscreen canvas before inference so that the
 * GPU texture is synchronously available (avoids the lag where a seeked video
 * element's WebGL texture still shows the previous frame).
 *
 * @param video       HTMLVideoElement (must have duration).
 * @param fps         Frame rate to sample at (default 30).
 * @param onProgress  Called with 0–1 progress.
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

  // Use a downsampled offscreen canvas for speed (max 640 px wide).
  // Keypoints returned by MoveNet are in the offscreen canvas coordinate
  // system; we scale them back to native video resolution before storing so
  // that the existing Canvas.tsx rendering logic (scaleXY = dw / vW) works
  // unchanged.
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
      // Fallback: resolve after 1 s in case 'seeked' never fires
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

    // Draw the current video frame to the offscreen canvas so the pixel data
    // is immediately available to WebGL — avoids texture lag after seeking.
    offCtx.drawImage(video, 0, 0, inferW, inferH);

    try {
      const poses = await det.estimatePoses(offscreen, { flipHorizontal: false });
      if (poses.length > 0) {
        // Scale keypoints from inference resolution to video native resolution
        const scaledPoses: Pose[] = poses.map((pose) => ({
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
    // Yield every 5 frames to keep the UI responsive
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
  // Only return if within 2 frames
  if (Math.abs(candidate.frameIndex - targetFrame) <= 2) return candidate;
  return null;
}

export { KEYPOINT_NAMES };
