/**
 * PoseWorkerBridge — MoveNet SinglePose Lightning in a dedicated Web Worker (WASM).
 * One shared worker per tab session so the model is not reloaded each time skeleton toggles.
 * Falls back to main-thread WebGL only if the worker cannot start.
 */

import type { SmoothPoint } from '@/lib/keypointSmooth';
import { smoothKeypointsEma } from '@/lib/keypointSmooth';

export type PoseKeypoint = { x: number; y: number; score: number; name: string };
type ResultCb = (keypoints: PoseKeypoint[] | null) => void;

/** EMA: 30% new sample, 70% previous — reduces jitter per spec. */
const SKELETON_EMA_ALPHA = 0.3;

let globalWorker: Worker | null = null;
let globalWorkerReady = false;
let globalInitTimeout: ReturnType<typeof setTimeout> | null = null;
let activeBridge: PoseWorkerBridge | null = null;

function attachWorkerResultRouting() {
  if (!globalWorker) return;
  globalWorker.onmessage = (e: MessageEvent) => {
    const { data } = e;
    if (data?.type === 'result') {
      activeBridge?.handleWorkerMessage(e);
    }
  };
}

export function warmupMoveNetWorker() {
  if (typeof window === 'undefined') return;
  if (globalWorker && globalWorkerReady) return;
  const b = new PoseWorkerBridge({});
  b.onReady(() => {
    b.dispose();
  });
}

export function terminateGlobalPoseWorker() {
  if (globalInitTimeout) {
    clearTimeout(globalInitTimeout);
    globalInitTimeout = null;
  }
  if (globalWorker) {
    try {
      globalWorker.terminate();
    } catch {
      /* noop */
    }
    globalWorker = null;
  }
  globalWorkerReady = false;
}

export class PoseWorkerBridge {
  private worker: Worker | null = null;
  private mode: 'worker' | 'main-thread' | 'initializing' = 'initializing';
  private disposed = false;
  private inFlight = false;
  private pendingResendVideo: HTMLVideoElement | null = null;
  private frameCount = 0;
  private _frameSkip: number;
  private resultCb: ResultCb | null = null;
  private readyCb: (() => void) | null = null;
  private statusCb: ((msg: string) => void) | null = null;
  private smoothPrev: SmoothPoint[] | null = null;

  private fallbackDetector: any = null;
  private idleId: number | null = null;

  constructor(opts?: { frameSkip?: number; onStatus?: (msg: string) => void }) {
    this._frameSkip = opts?.frameSkip ?? 0;
    this.statusCb = opts?.onStatus ?? null;
    activeBridge = this;
    this.tryWorker();
  }

  onResult(cb: ResultCb) {
    this.resultCb = cb;
  }

  onReady(cb: () => void) {
    if (this.mode !== 'initializing') {
      cb();
    } else {
      this.readyCb = cb;
    }
  }

  sendFrame(video: HTMLVideoElement) {
    if (this.disposed) return;
    if (this.mode === 'initializing') return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    this.frameCount++;
    if (this._frameSkip > 0 && this.frameCount % (this._frameSkip + 1) !== 0) return;

    if (this.mode === 'worker') {
      if (this.inFlight) {
        this.pendingResendVideo = video;
        return;
      }
      this.sendToWorker(video);
    } else {
      if (this.inFlight) {
        this.pendingResendVideo = video;
        return;
      }
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

  resetSmoothing() {
    this.smoothPrev = null;
  }

  dispose() {
    this.disposed = true;
    if (activeBridge === this) activeBridge = null;

    if (this.worker && this.worker !== globalWorker) {
      try {
        this.worker.terminate();
      } catch {
        /* noop */
      }
    }
    this.worker = null;

    if (this.idleId != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idleId);
      this.idleId = null;
    }
    if (this.mode === 'main-thread') {
      import('@/lib/sharedPoseDetector').then((m) => m.releasePoseDetector()).catch(() => {});
    }
    this.resultCb = null;
    this.pendingResendVideo = null;
    this.inFlight = false;
  }

  /** Called from module worker router */
  handleWorkerMessage(e: MessageEvent) {
    if (this.disposed) return;
    const { data } = e;
    if (data.type === 'result') {
      this.inFlight = false;
      this.deliverKeypoints(data.keypoints);
      const v = this.pendingResendVideo;
      this.pendingResendVideo = null;
      if (v && !this.disposed) {
        queueMicrotask(() => {
          if (!this.disposed) this.sendFrame(v);
        });
      }
    }
  }

  private tryWorker() {
    try {
      if (globalWorker && globalWorkerReady) {
        this.statusCb?.('Skeleton ready (worker)');
        this.worker = globalWorker;
        this.mode = 'worker';
        attachWorkerResultRouting();
        this.readyCb?.();
        this.readyCb = null;
        return;
      }

      this.statusCb?.('Loading pose model (worker)…');

      if (!globalWorker) {
        const w = new Worker(new URL('./poseWorker.ts', import.meta.url));
        globalWorker = w;
        globalWorkerReady = false;

        globalInitTimeout = setTimeout(() => {
          console.warn('[PoseWorkerBridge] Worker init timed out — falling back to main thread');
          terminateGlobalPoseWorker();
          if (activeBridge === this && !this.disposed) this.initMainThread();
        }, 15_000);

        w.onmessage = (e: MessageEvent) => {
          const { data } = e;
          if (data.type === 'ready') {
            if (globalInitTimeout) {
              clearTimeout(globalInitTimeout);
              globalInitTimeout = null;
            }
            globalWorkerReady = true;
            attachWorkerResultRouting();
            const br = activeBridge;
            if (br && !br.disposed) {
              br.mode = 'worker';
              br.worker = globalWorker;
              br.statusCb?.('Skeleton ready (worker)');
              br.readyCb?.();
              br.readyCb = null;
            }
            if (process.env.NODE_ENV !== 'production') {
              console.log('[PoseWorkerBridge] Worker mode active (shared)');
            }
          } else if (data.type === 'error') {
            if (globalInitTimeout) {
              clearTimeout(globalInitTimeout);
              globalInitTimeout = null;
            }
            console.warn('[PoseWorkerBridge] Worker error:', data.message, '— falling back');
            terminateGlobalPoseWorker();
            if (activeBridge === this && !this.disposed) this.initMainThread();
          }
        };

        w.onerror = () => {
          if (globalInitTimeout) {
            clearTimeout(globalInitTimeout);
            globalInitTimeout = null;
          }
          console.warn('[PoseWorkerBridge] Worker onerror — falling back');
          terminateGlobalPoseWorker();
          if (activeBridge === this && !this.disposed) this.initMainThread();
        };

        w.postMessage({ type: 'init' });
      }

      this.worker = globalWorker;
      this.mode = 'initializing';
    } catch {
      console.warn('[PoseWorkerBridge] Worker creation failed — falling back');
      this.initMainThread();
    }
  }

  private sendToWorker(video: HTMLVideoElement) {
    if (!this.worker || !globalWorkerReady) return;
    this.inFlight = true;
    try {
      createImageBitmap(video)
        .then((bmp) => {
          if (this.disposed || !this.worker) {
            bmp.close();
            this.inFlight = false;
            return;
          }
          this.worker.postMessage({ type: 'detect', bitmap: bmp, frameId: this.frameCount }, [bmp]);
        })
        .catch(() => {
          this.inFlight = false;
        });
    } catch {
      this.inFlight = false;
    }
  }

  private async initMainThread() {
    this.statusCb?.('Loading pose model…');
    try {
      const { acquirePoseDetector } = await import('@/lib/sharedPoseDetector');
      const det = await acquirePoseDetector();
      if (this.disposed) return;
      this.fallbackDetector = det;
      this.mode = 'main-thread';
      if (process.env.NODE_ENV !== 'production') {
        console.log('[PoseWorkerBridge] Main-thread fallback active (WebGL)');
      }
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
        const v = this.pendingResendVideo;
        this.pendingResendVideo = null;
        if (v && !this.disposed) {
          queueMicrotask(() => {
            if (!this.disposed) this.sendFrame(v);
          });
        }
      }
    };

    if (typeof requestIdleCallback === 'function') {
      this.idleId = requestIdleCallback(
        () => {
          this.idleId = null;
          void run();
        },
        { timeout: 32 },
      );
    } else {
      setTimeout(() => {
        void run();
      }, 0);
    }
  }

  private deliverKeypoints(raw: PoseKeypoint[] | null) {
    if (!raw?.length) {
      this.resultCb?.(null);
      return;
    }

    const smoothed = smoothKeypointsEma(this.smoothPrev, raw, SKELETON_EMA_ALPHA);
    this.smoothPrev = smoothed as SmoothPoint[];
    this.resultCb?.(smoothed as PoseKeypoint[]);
  }
}
