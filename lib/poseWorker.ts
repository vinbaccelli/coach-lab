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
    console.log('[PoseWorker] Initializing TF.js WASM backend…');

    const tf = await import('@tensorflow/tfjs-core');
    const wasmBackend = await import('@tensorflow/tfjs-backend-wasm');

    wasmBackend.setWasmPaths(
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/',
    );

    await tf.setBackend('wasm');
    await tf.ready();
    console.log('[PoseWorker] TF.js WASM backend ready');

    const pd = await import('@tensorflow-models/pose-detection');
    detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
      modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: false,
    });

    ready = true;
    self.postMessage({ type: 'ready' });
    console.log('[PoseWorker] MoveNet SinglePose Lightning loaded');
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

      const raw = poses?.[0]?.keypoints;
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
