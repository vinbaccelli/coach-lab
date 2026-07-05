/**
 * Web Worker for off-main-thread MoveNet pose detection.
 *
 * Backend chain: WebGPU → WebGL (OffscreenCanvas) → WASM. GPU backends run
 * inference 3–10× faster than WASM, which lets us load the higher-precision
 * MoveNet THUNDER model on GPU while keeping LIGHTNING as the WASM fallback.
 * (The old "WebGL is unavailable inside workers" assumption is obsolete —
 * OffscreenCanvas WebGL works in workers in all current browsers.)
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

/** Race a backend init against a hard timeout so a hung GPU probe can never stall the chain. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} init timed out`)), ms)),
  ]);
}

async function initWasm(tf: any): Promise<void> {
  const wasmBackend = await import('@tensorflow/tfjs-backend-wasm');
  wasmBackend.setWasmPaths(
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/',
  );
  await tf.setBackend('wasm');
  await tf.ready();
}

async function pickBackend(tf: any, wasmOnly: boolean): Promise<string> {
  if (!wasmOnly) {
    // 1. WebGL via OffscreenCanvas — the most stable GPU path in workers.
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        await import('@tensorflow/tfjs-backend-webgl');
        const ok = await withTimeout(Promise.resolve(tf.setBackend('webgl')), 6000, 'webgl');
        if (ok) {
          await tf.ready();
          return 'webgl';
        }
      }
    } catch (e) {
      console.warn('[PoseWorker] webgl backend unavailable:', (e as Error)?.message);
    }

    // 2. WebGPU — fastest when it works (Chromium), but probes can hang.
    try {
      if ((self.navigator as unknown as { gpu?: unknown })?.gpu) {
        await import('@tensorflow/tfjs-backend-webgpu');
        const ok = await withTimeout(Promise.resolve(tf.setBackend('webgpu')), 6000, 'webgpu');
        if (ok) {
          await tf.ready();
          return 'webgpu';
        }
      }
    } catch (e) {
      console.warn('[PoseWorker] webgpu backend unavailable:', (e as Error)?.message);
    }
  }

  // 3. WASM — universal fallback, the configuration that works everywhere.
  await initWasm(tf);
  return 'wasm';
}

async function init(wasmOnly = false) {
  try {
    self.postMessage({ type: 'status', message: 'Loading AI engine…' });
    const tf = await import('@tensorflow/tfjs-core');
    const backend = await pickBackend(tf, wasmOnly);

    self.postMessage({ type: 'status', message: 'Loading pose detection model…' });
    const pd = await import('@tensorflow-models/pose-detection');
    const gpu = backend === 'webgpu' || backend === 'webgl';
    detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
      // GPU: THUNDER (markedly more precise joints) still runs realtime.
      // WASM: LIGHTNING keeps the fallback fast enough to follow play.
      modelType: gpu
        ? pd.movenet.modelType.SINGLEPOSE_THUNDER
        : pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: false,
    });

    ready = true;
    self.postMessage({ type: 'ready', backend });
    console.log(`[PoseWorker] Ready — backend: ${backend}, model: ${gpu ? 'thunder' : 'lightning'}`);
  } catch (err: any) {
    console.error('[PoseWorker] Init failed:', err);
    self.postMessage({ type: 'error', message: err?.message || 'Worker init failed' });
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { data } = e;

  if (data.type === 'init') {
    await init(!!data.wasmOnly);
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
      if (!poses || poses.length === 0) console.warn('[PoseWorker] No poses detected in frame', data.frameId);

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
    } catch (err) {
      console.error('[PoseWorker] detect error:', err);
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
