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

async function init() {
  try {
    if (process.env.NODE_ENV !== 'production') {
    }

    const tf = await import('@tensorflow/tfjs-core');
    const wasmBackend = await import('@tensorflow/tfjs-backend-wasm');

    wasmBackend.setWasmPaths(
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/',
    );

    await tf.setBackend('wasm');
    await tf.ready();
    if (process.env.NODE_ENV !== 'production') {
    }

    const pd = await import('@tensorflow-models/pose-detection');
    detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
      modelType: pd.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableSmoothing: false,
      enableTracking: true,
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
      const poses = await detector.estimatePoses(bitmap, { flipHorizontal: false });
      bitmap.close();

      // Pick the largest person (biggest keypoint spread) — avoids detecting spectators
      let best = poses?.[0];
      if (poses && poses.length > 1) {
        let bestArea = 0;
        for (const pose of poses) {
          const kps = pose.keypoints?.filter((k: any) => (k.score ?? 0) >= 0.2) ?? [];
          if (kps.length < 4) continue;
          const xs = kps.map((k: any) => k.x);
          const ys = kps.map((k: any) => k.y);
          const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
          if (area > bestArea) { bestArea = area; best = pose; }
        }
      }

      const raw = best?.keypoints;
      const keypoints =
        raw?.map((kp: any) => ({
          x: kp.x,
          y: kp.y,
          score: kp.score ?? 0,
          name: kp.name ?? '',
        })) ?? null;

      self.postMessage({ type: 'result', keypoints, frameId: data.frameId });
    } catch {
      if (data.bitmap && typeof data.bitmap.close === 'function') data.bitmap.close();
      self.postMessage({ type: 'result', keypoints: null, frameId: data.frameId });
    }
  }
};
