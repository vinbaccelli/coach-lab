/**
 * PoseWorkerBridge — main-thread facade for off-thread MoveNet pose detection.
 *
 * 1. Tries to spin up a Web Worker (WASM backend).
 * 2. If the worker fails to initialise, falls back to running pose detection on
 *    the main thread via the shared WebGL singleton + requestIdleCallback.
 *
 * Both paths expose the same API so Canvas.tsx doesn't need to branch.
 */

import type { SmoothPoint } from '@/lib/keypointSmooth';
import { smoothKeypointsEma } from '@/lib/keypointSmooth';

export type PoseKeypoint = { x: number; y: number; score: number; name: string };
type ResultCb = (keypoints: PoseKeypoint[] | null) => void;

export class PoseWorkerBridge {
  /* ── state ──────────────────────────────────────────────────────────── */
  private worker: Worker | null = null;
  private mode: 'worker' | 'main-thread' | 'initializing' = 'initializing';
  private disposed = false;
  private inFlight = false;
  private frameCount = 0;
  private _frameSkip: number;
  private resultCb: ResultCb | null = null;
  private readyCb: (() => void) | null = null;
  private statusCb: ((msg: string) => void) | null = null;
  private smoothPrev: SmoothPoint[] | null = null;

  /* main-thread fallback handles */
  private fallbackDetector: any = null;
  private idleId: number | null = null;

  constructor(opts?: { frameSkip?: number; onStatus?: (msg: string) => void }) {
    this._frameSkip = opts?.frameSkip ?? 2;
    this.statusCb = opts?.onStatus ?? null;
    this.tryWorker();
  }

  /* ── public API ─────────────────────────────────────────────────────── */

  /** Register a callback that receives keypoints each time a frame is processed. */
  onResult(cb: ResultCb) {
    this.resultCb = cb;
  }

  /** Register a callback that fires once when the detector is ready. */
  onReady(cb: () => void) {
    if (this.mode !== 'initializing') {
      cb();
    } else {
      this.readyCb = cb;
    }
  }

  /** Send a video frame for detection. Respects frame-skip and in-flight guard. */
  sendFrame(video: HTMLVideoElement) {
    if (this.disposed) return;
    if (this.mode === 'initializing') return;
    if (this.inFlight) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    this.frameCount++;
    if (this._frameSkip > 0 && this.frameCount % (this._frameSkip + 1) !== 0) return;

    if (this.mode === 'worker') {
      this.sendToWorker(video);
    } else {
      this.sendToMainThread(video);
    }
  }

  set frameSkip(n: number) {
    this._frameSkip = Math.max(0, n);
  }

  get frameSkip() {
    return this._frameSkip;
  }

  get isReady() {
    return this.mode !== 'initializing';
  }

  /** Reset temporal smoothing (call on video source change). */
  resetSmoothing() {
    this.smoothPrev = null;
  }

  dispose() {
    this.disposed = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.idleId != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idleId);
      this.idleId = null;
    }
    if (this.mode === 'main-thread') {
      import('@/lib/sharedPoseDetector').then((m) => m.releasePoseDetector()).catch(() => {});
    }
    this.resultCb = null;
  }

  /* ── worker path ────────────────────────────────────────────────────── */

  private tryWorker() {
    try {
      this.statusCb?.('Loading pose model (worker)…');
      const w = new Worker(new URL('./poseWorker.ts', import.meta.url));
      this.worker = w;

      const initTimeout = setTimeout(() => {
        console.warn('[PoseWorkerBridge] Worker init timed out — falling back to main thread');
        w.terminate();
        this.worker = null;
        this.initMainThread();
      }, 15_000);

      w.onmessage = (e: MessageEvent) => {
        const { data } = e;
        if (data.type === 'ready') {
          clearTimeout(initTimeout);
          this.mode = 'worker';
          console.log('[PoseWorkerBridge] Worker mode active');
          this.statusCb?.('Skeleton ready (worker)');
          this.readyCb?.();
          this.readyCb = null;
        } else if (data.type === 'error') {
          clearTimeout(initTimeout);
          console.warn('[PoseWorkerBridge] Worker error:', data.message, '— falling back');
          w.terminate();
          this.worker = null;
          this.initMainThread();
        } else if (data.type === 'result') {
          this.inFlight = false;
          this.deliverKeypoints(data.keypoints);
        }
      };

      w.onerror = () => {
        clearTimeout(initTimeout);
        console.warn('[PoseWorkerBridge] Worker onerror — falling back');
        w.terminate();
        this.worker = null;
        this.initMainThread();
      };

      w.postMessage({ type: 'init' });
    } catch {
      console.warn('[PoseWorkerBridge] Worker creation failed — falling back');
      this.initMainThread();
    }
  }

  private sendToWorker(video: HTMLVideoElement) {
    this.inFlight = true;
    try {
      createImageBitmap(video).then((bmp) => {
        if (this.disposed || !this.worker) {
          bmp.close();
          this.inFlight = false;
          return;
        }
        this.worker.postMessage(
          { type: 'detect', bitmap: bmp, frameId: this.frameCount },
          [bmp],
        );
      }).catch(() => {
        this.inFlight = false;
      });
    } catch {
      this.inFlight = false;
    }
  }

  /* ── main-thread fallback ───────────────────────────────────────────── */

  private async initMainThread() {
    this.statusCb?.('Loading pose model…');
    try {
      const { acquirePoseDetector } = await import('@/lib/sharedPoseDetector');
      const det = await acquirePoseDetector();
      if (this.disposed) return;
      this.fallbackDetector = det;
      this.mode = 'main-thread';
      console.log('[PoseWorkerBridge] Main-thread fallback active (WebGL)');
      this.statusCb?.('Skeleton ready');
      this.readyCb?.();
      this.readyCb = null;
    } catch (err: any) {
      console.error('[PoseWorkerBridge] Main-thread init failed:', err);
      this.statusCb?.(`Skeleton load failed: ${err?.message}`);
    }
  }

  private sendToMainThread(video: HTMLVideoElement) {
    if (!this.fallbackDetector) return;
    this.inFlight = true;
    const det = this.fallbackDetector;

    const run = async () => {
      try {
        const poses = await det.estimatePoses(video, { flipHorizontal: false });
        const raw = poses?.[0]?.keypoints as PoseKeypoint[] | undefined;
        this.deliverKeypoints(raw?.length ? raw : null);
      } catch {
        this.deliverKeypoints(null);
      } finally {
        this.inFlight = false;
      }
    };

    if (typeof requestIdleCallback === 'function') {
      this.idleId = requestIdleCallback(() => { void run(); }, { timeout: 50 });
    } else {
      setTimeout(() => { void run(); }, 0);
    }
  }

  /* ── shared delivery + smoothing ────────────────────────────────────── */

  private deliverKeypoints(raw: PoseKeypoint[] | null) {
    if (!raw?.length) {
      this.resultCb?.(null);
      return;
    }

    const smoothed = smoothKeypointsEma(this.smoothPrev, raw, 0.45);
    this.smoothPrev = smoothed as SmoothPoint[];
    this.resultCb?.(smoothed as PoseKeypoint[]);
  }
}
