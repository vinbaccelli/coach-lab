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
      const focus: { x: number; y: number } | null = data.focusPoint ?? null;

      let cropX = 0, cropY = 0, cropW = fullW, cropH = fullH;

      if (focus) {
        // Crop around the user's click point (~80% of frame)
        const ratio = 0.8;
        cropW = Math.round(fullW * ratio);
        cropH = Math.round(fullH * ratio);
        cropX = Math.round(Math.max(0, Math.min(fullW - cropW, focus.x * fullW - cropW / 2)));
        cropY = Math.round(Math.max(0, Math.min(fullH - cropH, focus.y * fullH - cropH / 2)));
      }

      let keypoints = null;

      if (focus) {
        // Try cropped detection first
        const cropped = await createImageBitmap(bitmap, cropX, cropY, cropW, cropH);
        const poses = await detector.estimatePoses(cropped, { flipHorizontal: false });
        cropped.close();
        const raw = poses?.[0]?.keypoints;
        if (raw && raw.some((kp: any) => (kp.score ?? 0) >= 0.3)) {
          const scaleX = cropW / (cropW || 1);
          const scaleY = cropH / (cropH || 1);
          keypoints = raw.map((kp: any) => ({
            x: kp.x * scaleX + cropX,
            y: kp.y * scaleY + cropY,
            score: kp.score ?? 0,
            name: kp.name ?? '',
          }));
        } else {
          // Crop failed — fallback to full frame
          const poses2 = await detector.estimatePoses(bitmap, { flipHorizontal: false });
          const raw2 = poses2?.[0]?.keypoints;
          keypoints = raw2?.map((kp: any) => ({
            x: kp.x, y: kp.y, score: kp.score ?? 0, name: kp.name ?? '',
          })) ?? null;
        }
      } else {
        const poses = await detector.estimatePoses(bitmap, { flipHorizontal: false });
        const raw = poses?.[0]?.keypoints;
        keypoints = raw?.map((kp: any) => ({
          x: kp.x, y: kp.y, score: kp.score ?? 0, name: kp.name ?? '',
        })) ?? null;
      }

      bitmap.close();
      self.postMessage({ type: 'result', keypoints, frameId: data.frameId });
    } catch {
      if (data.bitmap && typeof data.bitmap.close === 'function') data.bitmap.close();
      self.postMessage({ type: 'result', keypoints: null, frameId: data.frameId });
    }
  }
};
