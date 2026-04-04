/**
 * Pose Detection module for Coach Lab.
 *
 * Uses Google MediaPipe BlazePose via @tensorflow-models/pose-detection.
 * Loads lazily to avoid including the large TensorFlow.js bundle in the initial page load.
 *
 * Key exports:
 *   loadPoseModel()       — Loads and caches the BlazePose model.
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
  poses: Pose[];
}

// Singleton detector
let detector: PoseDetector | null = null;
let detectorLoading = false;
let detectorLoadPromise: Promise<PoseDetector> | null = null;

/** Load the BlazePose detector (singleton). Resolves quickly on subsequent calls. */
export async function loadPoseModel(modelType: 'lite' | 'full' = 'lite'): Promise<PoseDetector> {
  if (detector) return detector;
  if (detectorLoadPromise) return detectorLoadPromise;

  detectorLoading = true;
  detectorLoadPromise = (async () => {
    // Dynamic imports so TF.js is only bundled when this function is called
    const tf = await import('@tensorflow/tfjs');
    await tf.ready();

    const poseDetection = await import('@tensorflow-models/pose-detection');

    const model = poseDetection.SupportedModels.BlazePose;
    const det = await poseDetection.createDetector(model, {
      runtime: 'tfjs',
      modelType,
    });

    detector = det;
    detectorLoading = false;
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

/** Map keypoint name → index in the poses[0].keypoints array */
const KEYPOINT_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear',
  'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky',
  'left_index', 'right_index',
  'left_thumb', 'right_thumb',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
  'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
];

/** BlazePose bone connections (keypoint name pairs) */
const BONE_CONNECTIONS: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_heel'],
  ['left_heel', 'left_foot_index'],
  ['right_ankle', 'right_heel'],
  ['right_heel', 'right_foot_index'],
  ['nose', 'left_shoulder'],
  ['nose', 'right_shoulder'],
];

function findKeypoint(kps: Keypoint[], name: string): Keypoint | undefined {
  return kps.find((k) => k.name === name);
}

/**
 * Draw a BlazePose skeleton on a 2D canvas context.
 *
 * @param ctx      2D rendering context.
 * @param poses    Array of poses from estimatePoses().
 * @param w        Canvas pixel width.
 * @param h        Canvas pixel height.
 * @param scaleX   Horizontal scale: canvas.width / video.videoWidth
 * @param scaleY   Vertical scale: canvas.height / video.videoHeight
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

  ctx.restore();
}

/**
 * Pre-process all frames in a video, caching poses keyed by frame index.
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
  const det = await loadPoseModel('full');
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return [];

  const totalFrames = Math.floor(duration * fps);
  const results: CachedPoseFrame[] = [];

  const seekTo = (t: number): Promise<void> =>
    new Promise((resolve) => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
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
    try {
      const poses = await det.estimatePoses(video, { flipHorizontal: false });
      if (poses.length > 0) {
        results.push({ frameIndex: f, poses });
      }
    } catch {
      // Ignore inference errors on individual frames
    }
    if (onProgress) onProgress((f + 1) / totalFrames);
    // Yield every 5 frames
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
