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
      const focus: { x: number; y: number } | null = data.focusPoint ?? null;
      const srcW: number = data.srcWidth || bitmap.width;
      const srcH: number = data.srcHeight || bitmap.height;
      const bmpW = bitmap.width;
      const bmpH = bitmap.height;

      let cropX = 0, cropY = 0, cropW = bmpW, cropH = bmpH;
      const useCrop = !!focus;

      if (focus) {
        const ratio = 0.6;
        cropW = Math.round(bmpW * ratio);
        cropH = Math.round(bmpH * ratio);
        cropX = Math.round(Math.max(0, Math.min(bmpW - cropW, focus.x * bmpW - cropW / 2)));
        cropY = Math.round(Math.max(0, Math.min(bmpH - cropH, focus.y * bmpH - cropH / 2)));
      }

      let source: ImageBitmap;
      if (useCrop) {
        source = await createImageBitmap(bitmap, cropX, cropY, cropW, cropH);
        bitmap.close();
      } else {
        source = bitmap;
      }

      const poses = await detector.estimatePoses(source, { flipHorizontal: false });
      const raw = poses?.[0]?.keypoints;

      // Scale keypoints back to original video resolution
      const upX = srcW / bmpW;
      const upY = srcH / bmpH;

      let keypoints;
      if (useCrop && raw) {
        keypoints = raw.map((kp: any) => ({
          x: (kp.x + cropX) * upX,
          y: (kp.y + cropY) * upY,
          score: kp.score ?? 0,
          name: kp.name ?? '',
        }));
      } else {
        keypoints = raw?.map((kp: any) => ({
          x: kp.x * upX, y: kp.y * upY, score: kp.score ?? 0, name: kp.name ?? '',
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
