/**
 * PoseWorkerBridge — MoveNet SinglePose Lightning in a dedicated Web Worker (WASM).
 * One shared worker per tab session so the model is not reloaded each time skeleton toggles.
 * Falls back to main-thread WebGL only if the worker cannot start.
 */

import { OneEuroKeypointSmoother } from '@/lib/keypointSmooth';

export type PoseKeypoint = { x: number; y: number; score: number; name: string };
type ResultCb = (keypoints: PoseKeypoint[] | null) => void;

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

/** @deprecated — bridge handles worker lifecycle internally */
export function warmupMoveNetWorker() {}

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
  // Speed-adaptive smoothing: steady at rest, near-zero lag on fast swings.
  private smoother = new OneEuroKeypointSmoother();

  private fallbackDetector: any = null;
  private idleId: number | null = null;
  private _focusPoint: { x: number; y: number } | null = null;
  /** Video-px per bitmap-px of the frame currently in flight (downscaled send). */
  private lastSentScale = 1;
  /** One retry with a fresh wasm-only worker before the main-thread fallback. */
  private triedWasmOnly = false;

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
    this.smoother.reset();
  }

  /**
   * Clear transient in-flight/pending state. Called when the skeleton is
   * re-enabled and an existing bridge is reused, so a frame left in-flight by a
   * previous disable can never permanently block new sends. Safe on a healthy
   * bridge — the worker processes sequentially and clears inFlight per result.
   */
  resume() {
    this.inFlight = false;
    this.pendingResendVideo = null;
    // Re-claim worker-result routing. A single shared worker delivers results
    // only to the last-active bridge (set in the constructor). A reused bridge
    // (skeleton re-enabled without reconstruction) must re-assert itself, or its
    // results would be routed to another bridge — or nowhere — and the skeleton
    // would never come back. Root cause of the repeated-toggle desync.
    if (!this.disposed) {
      activeBridge = this;
      if (this.mode === 'worker') attachWorkerResultRouting();
    }
  }

  setFocusPoint(pt: { x: number; y: number } | null) {
    this._focusPoint = pt;
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
      // Worker coords are in (possibly downscaled) bitmap space — map back to
      // video-native pixels before smoothing/consumption.
      let kps: PoseKeypoint[] | null = data.keypoints ?? null;
      if (kps && this.lastSentScale !== 1) {
        const f = this.lastSentScale;
        kps = kps.map((k) => ({ ...k, x: k.x * f, y: k.y * f }));
      }
      this.deliverKeypoints(kps);
      const v = this.pendingResendVideo;
      this.pendingResendVideo = null;
      if (v && !this.disposed) {
        queueMicrotask(() => {
          if (!this.disposed) this.sendFrame(v);
        });
      }
    }
  }

  /**
   * Failure ladder: a broken/hung GPU worker retries ONCE as a fresh wasm-only
   * worker (the configuration that works in every browser) before falling back
   * to main-thread WebGL.
   */
  private failOver() {
    if (this.disposed) return;
    terminateGlobalPoseWorker();
    if (!this.triedWasmOnly) {
      this.triedWasmOnly = true;
      this.statusCb?.('Retrying skeleton engine…');
      this.tryWorker(true);
    } else {
      this.initMainThread();
    }
  }

  private tryWorker(wasmOnly = false) {
    try {
      // Fast path: worker already loaded from a previous session
      if (globalWorker && globalWorkerReady) {
        this.statusCb?.('Skeleton ready');
        this.worker = globalWorker;
        this.mode = 'worker';
        attachWorkerResultRouting();
        this.readyCb?.();
        this.readyCb = null;
        return;
      }

      // Kill any stale worker that never finished loading
      if (globalWorker && !globalWorkerReady) {
        terminateGlobalPoseWorker();
      }

      this.statusCb?.('Downloading skeleton model…');

      const w = new Worker(new URL('./poseWorker.ts', import.meta.url));
      globalWorker = w;
      globalWorkerReady = false;

      // 30s timeout — model download can be slow on first load
      globalInitTimeout = setTimeout(() => {
        console.warn('[PoseWorkerBridge] Worker timed out after 30s — failing over');
        this.statusCb?.('Worker timed out — using fallback…');
        this.failOver();
      }, 30_000);

      w.onmessage = (e: MessageEvent) => {
        const { data } = e;
        if (data.type === 'ready') {
          if (globalInitTimeout) { clearTimeout(globalInitTimeout); globalInitTimeout = null; }
          globalWorkerReady = true;
          // Always notify the CURRENT active bridge (which may differ from `this`)
          const target = activeBridge ?? this;
          if (!target.disposed) {
            target.worker = globalWorker;
            target.mode = 'worker';
            attachWorkerResultRouting();
            target.statusCb?.('Skeleton ready');
            target.readyCb?.();
            target.readyCb = null;
          }
          console.log('[PoseWorkerBridge] Worker ready');
        } else if (data.type === 'status') {
          const target = activeBridge ?? this;
          if (!target.disposed) target.statusCb?.(data.message);
        } else if (data.type === 'error') {
          if (globalInitTimeout) { clearTimeout(globalInitTimeout); globalInitTimeout = null; }
          console.error('[PoseWorkerBridge] Worker error:', data.message);
          this.statusCb?.('Skeleton engine hiccup — retrying…');
          this.failOver();
        }
      };

      w.onerror = () => {
        if (globalInitTimeout) { clearTimeout(globalInitTimeout); globalInitTimeout = null; }
        console.warn('[PoseWorkerBridge] Worker onerror — failing over');
        this.statusCb?.('Skeleton engine hiccup — retrying…');
        this.failOver();
      };

      w.postMessage({ type: 'init', wasmOnly });
    } catch {
      console.warn('[PoseWorkerBridge] Worker creation failed — falling back');
      this.initMainThread();
    }
  }

  private sendToWorker(video: HTMLVideoElement) {
    if (!this.worker || !globalWorkerReady) return;
    this.inFlight = true;
    try {
      // The model's input is only 192–256px — shipping full-res frames wastes
      // capture, transfer, and tensor-conversion time (the dominant cost on
      // the WASM path). 512px keeps ample margin for the 0.6 focus crop.
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      const TARGET = 512;
      const scale = vw > 0 ? Math.min(1, TARGET / Math.max(vw, vh)) : 1;
      const make: Promise<ImageBitmap> = scale < 1
        ? createImageBitmap(video, {
            resizeWidth: Math.max(1, Math.round(vw * scale)),
            resizeHeight: Math.max(1, Math.round(vh * scale)),
            resizeQuality: 'low',
          }).catch(() => createImageBitmap(video)) // older engines: no resize options
        : createImageBitmap(video);

      make
        .then((bmp) => {
          if (this.disposed || !this.worker) {
            bmp.close();
            this.inFlight = false;
            return;
          }
          this.lastSentScale = bmp.width > 0 && vw > 0 ? vw / bmp.width : 1;
          this.worker.postMessage({ type: 'detect', bitmap: bmp, frameId: this.frameCount, focusPoint: this._focusPoint }, [bmp]);
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

    const smoothed = this.smoother.apply(raw, performance.now());
    this.resultCb?.(smoothed as PoseKeypoint[]);
  }
}
