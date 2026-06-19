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
      const fullW = bitmap.width;
      const fullH = bitmap.height;

      // Center-crop to ~65% of the frame to focus on the main player
      const cropRatio = 0.65;
      const cropW = Math.round(fullW * cropRatio);
      const cropH = Math.round(fullH * cropRatio);
      const cropX = Math.round((fullW - cropW) / 2);
      const cropY = Math.round((fullH - cropH) / 2);

      const cropped = await createImageBitmap(bitmap, cropX, cropY, cropW, cropH);
      bitmap.close();

      const poses = await detector.estimatePoses(cropped, { flipHorizontal: false });
      cropped.close();

      // Map keypoints back to full-frame coordinates
      const raw = poses?.[0]?.keypoints;
      const scaleX = cropW / (cropped.width || cropW);
      const scaleY = cropH / (cropped.height || cropH);
      const keypoints =
        raw?.map((kp: any) => ({
          x: kp.x * scaleX + cropX,
          y: kp.y * scaleY + cropY,
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
