/**
 * Web Worker for off-main-thread MoveNet pose detection.
 * Uses TF.js WASM backend (WebGL is unavailable inside workers).
 *
 * Protocol:
 *   Main → Worker:  { type: 'init' }
 *   Main → Worker:  { type: 'detect', bitmap: ImageBitmap, frameId: number }
 *   Worker → Main:  { type: 'ready' }
 *   Worker → Main:  { type: 'error', message: string }
 *   Worker → Main:  { type: 'result', keypoints: Keypoint[] | null, frameId: number }
 */

/* eslint-disable no-restricted-globals */

let detector: any = null;
let ready = false;
let prevCentroid: { x: number; y: number } | null = null;

async function init() {
  try {
    if (process.env.NODE_ENV !== 'production') {
    }

    self.postMessage({ type: 'status', message: 'Loading TensorFlow WASM…' });
    const tf = await import('@tensorflow/tfjs-core');
    const wasmBackend = await import('@tensorflow/tfjs-backend-wasm');

    wasmBackend.setWasmPaths(
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/',
    );

    await tf.setBackend('wasm');
    await tf.ready();

    self.postMessage({ type: 'status', message: 'Loading pose detection model…' });
    const pd = await import('@tensorflow-models/pose-detection');
    detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
      modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: false,
    });

    ready = true;
    self.postMessage({ type: 'ready' });
    if (process.env.NODE_ENV !== 'production') {
    }
  } catch (err: any) {
    console.error('[PoseWorker] Init failed:', err);
    self.postMessage({ type: 'error', message: err?.message || 'Worker init failed' });
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { data } = e;

  if (data.type === 'init') {
    await init();
    return;
  }

  if (data.type === 'detect') {
    if (!ready || !detector) {
      self.postMessage({ type: 'result', keypoints: null, frameId: data.frameId });
      if (data.bitmap && typeof data.bitmap.close === 'function') data.bitmap.close();
      return;
    }

    try {
      const bitmap: ImageBitmap = data.bitmap;
      const focus: { x: number; y: number } | null = data.focusPoint ?? null;
      const fullW = bitmap.width;
      const fullH = bitmap.height;

      let cropX = 0, cropY = 0, cropW = fullW, cropH = fullH;
      const useCrop = !!focus;

      if (focus) {
        const ratio = 0.6;
        cropW = Math.round(fullW * ratio);
        cropH = Math.round(fullH * ratio);
        cropX = Math.round(Math.max(0, Math.min(fullW - cropW, focus.x * fullW - cropW / 2)));
        cropY = Math.round(Math.max(0, Math.min(fullH - cropH, focus.y * fullH - cropH / 2)));
      }

      let source: ImageBitmap;
      if (useCrop) {
        source = await createImageBitmap(bitmap, cropX, cropY, cropW, cropH);
        bitmap.close();
      } else {
        source = bitmap;
      }

      const poses = await detector.estimatePoses(source, { flipHorizontal: false });

      const bestPose = selectBestPose(poses, prevCentroid);
      const raw = bestPose?.keypoints;

      if (raw) {
        const cx = raw.reduce((s: number, k: any) => s + (k.x ?? 0), 0) / raw.length;
        const cy = raw.reduce((s: number, k: any) => s + (k.y ?? 0), 0) / raw.length;
        prevCentroid = { x: cx, y: cy };
      }

      if (poses.length > 1) {
        console.log(`[PoseWorker] ${poses.length} people detected, selected index ${poses.indexOf(bestPose)}`);
      }

      let keypoints;
      if (useCrop && raw) {
        const sx = cropW / source.width;
        const sy = cropH / source.height;
        keypoints = raw.map((kp: any) => ({
          x: kp.x * sx + cropX,
          y: kp.y * sy + cropY,
          score: kp.score ?? 0,
          name: kp.name ?? '',
        }));
      } else {
        keypoints = raw?.map((kp: any) => ({
          x: kp.x, y: kp.y, score: kp.score ?? 0, name: kp.name ?? '',
        })) ?? null;
      }

      source.close();
      self.postMessage({ type: 'result', keypoints, frameId: data.frameId });
    } catch {
      if (data.bitmap && typeof data.bitmap.close === 'function') data.bitmap.close();
      self.postMessage({ type: 'result', keypoints: null, frameId: data.frameId });
    }
  }
};

function selectBestPose(
  poses: any[],
  prev: { x: number; y: number } | null,
): any | null {
  if (!poses || poses.length === 0) return null;
  if (poses.length === 1) return poses[0];

  let best = poses[0];
  let bestScore = -Infinity;

  for (const pose of poses) {
    const kps = pose.keypoints;
    if (!kps || kps.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let validCount = 0;
    let cx = 0, cy = 0;
    for (const kp of kps) {
      if ((kp.score ?? 0) < 0.15) continue;
      validCount++;
      cx += kp.x;
      cy += kp.y;
      if (kp.x < minX) minX = kp.x;
      if (kp.y < minY) minY = kp.y;
      if (kp.x > maxX) maxX = kp.x;
      if (kp.y > maxY) maxY = kp.y;
    }
    if (validCount === 0) continue;

    const area = (maxX - minX) * (maxY - minY);
    cx /= validCount;
    cy /= validCount;

    let score = area;
    if (prev) {
      const dist = Math.sqrt((cx - prev.x) ** 2 + (cy - prev.y) ** 2);
      score = area / (1 + dist * 0.01);
    }

    if (score > bestScore) {
      bestScore = score;
      best = pose;
    }
  }

  return best;
}
