/**
 * RTMPose spike — engine adapters for the lab page. Every engine takes the SAME <video> element at the SAME paused time
 * and returns COCO-17 keypoints in video pixels, so the comparison is on identical frames.
 * Existing engines are used through their existing, unmodified entry points.
 */
import { COCO17, type Kp } from './core';
import { RtmposeEngine, PersonFinder, type RtmposeSize } from './engine';
import { retryImport as R } from './retryImport';

export interface LabEngine {
  id: string;
  label: string;
  init(): Promise<Record<string, unknown>>;
  detect(video: HTMLVideoElement): Promise<Kp[] | null>;
  dispose(): void;
}

const NAMES = new Set<string>(COCO17);
const clean = (kps: Array<{ x: number; y: number; score: number; name: string }> | null | undefined): Kp[] | null =>
  kps ? kps.filter((k) => NAMES.has(k.name)).map((k) => ({ x: k.x, y: k.y, score: k.score, name: k.name })) : null;

function movenet(id: string, label: string, model: 'thunder' | 'lightning'): LabEngine {
  let det: { estimatePoses(v: HTMLVideoElement): Promise<Array<{ keypoints: Array<{ x: number; y: number; score?: number; name?: string }> }>>; dispose?: () => void } | null = null;
  let backend = '';
  return {
    id, label,
    async init() {
      const tf = await R(() => import('@tensorflow/tfjs-core'));
      await R(() => import('@tensorflow/tfjs-backend-webgl'));
      await R(() => import('@tensorflow/tfjs-converter'));
      try { await tf.setBackend('webgl'); await tf.ready(); backend = 'webgl'; } catch {
        const wasm = await R(() => import('@tensorflow/tfjs-backend-wasm'));
        wasm.setWasmPaths('/tfjs-wasm/');
        await tf.setBackend('wasm'); await tf.ready(); backend = 'wasm';
      }
      const pd = await R(() => import('@tensorflow-models/pose-detection'));
      det = await pd.createDetector(pd.SupportedModels.MoveNet, {
        modelType: model === 'thunder' ? pd.movenet.modelType.SINGLEPOSE_THUNDER : pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
        modelUrl: `${window.location.origin}/models/movenet-${model}/model.json`,
        enableSmoothing: false,
      }) as never;
      return { backend, thread: 'main' };
    },
    async detect(video) {
      const poses = await det!.estimatePoses(video);
      return clean(poses[0]?.keypoints.map((k) => ({ x: k.x, y: k.y, score: k.score ?? 0, name: k.name ?? '' })));
    },
    dispose() { try { det?.dispose?.(); } catch { /* noop */ } det = null; },
  };
}

/** The CURRENT live engine exactly as the app runs it: PoseWorkerBridge (worker, WebGL Thunder, One Euro smoothing). Bridge is used, not modified. */
function appWorkerMoveNet(): LabEngine {
  let bridge: import('../poseWorkerBridge').PoseWorkerBridge | null = null;
  let pending: ((k: Kp[] | null) => void) | null = null;
  return {
    id: 'movenet-app-worker', label: 'MoveNet as the app runs it today (PoseWorkerBridge: worker, Thunder/WebGL, smoothing)',
    async init() {
      const { PoseWorkerBridge } = await R(() => import('../poseWorkerBridge'));
      bridge = new PoseWorkerBridge({ frameSkip: 0 });
      bridge.onResult((kps) => { const p = pending; pending = null; p?.(clean(kps as never)); });
      await new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error('worker not ready in 60 s')), 60000); bridge!.onReady(() => { clearTimeout(t); res(); }); });
      return { thread: 'worker (app bridge)' };
    },
    detect(video) {
      return new Promise<Kp[] | null>((resolve) => {
        pending = resolve;
        const t = setTimeout(() => { if (pending === resolve) { pending = null; resolve(null); } }, 3000);
        const done = resolve; pending = (k) => { clearTimeout(t); done(k); };
        bridge!.sendFrame(video);
      });
    },
    dispose() { try { bridge?.dispose(); } catch { /* noop */ } bridge = null; pending = null; },
  };
}

function mediapipeLive(): LabEngine {
  return {
    id: 'mp-live-full', label: 'MediaPipe Live (full, VIDEO mode, as used today with Foot Lines)',
    async init() { const m = await R(() => import('../mediapipePose')); await m.detectPoseLive(document.createElement('video')); return { model: 'full' }; },
    async detect(video) { const m = await R(() => import('../mediapipePose')); const r = await m.detectPoseLive(video); return r?.notReady ? null : clean(r?.kps); },
    dispose() { void R(() => import('../mediapipePose')).then((m) => m.disposeLiveLandmarker()); },
  };
}

function mediapipeCrop(id: string, label: string, quality: 'fast' | 'max', seeded = false, opts?: { proxy?: boolean }): LabEngine {
  let tracker: import('../mediapipePose').CropTracker | null = null;
  let finder: PersonFinder | null = null;
  return {
    id, label,
    async init() {
      const m = await R(() => import('../mediapipePose')); tracker = m.newCropTracker();
      if (seeded) { finder = new PersonFinder(); await finder.init(undefined, { proxy: opts?.proxy }); }
      return { model: m.TRACK_QUALITY[quality === 'fast' ? 'fast' : 'balanced'].model, seededByYolox: seeded };
    },
    async detect(video) {
      const m = await R(() => import('../mediapipePose'));
      const params = m.TRACK_QUALITY[quality === 'fast' ? 'fast' : 'balanced'];
      // Seeded variant: MediaPipe never finds a small player by itself (it ran 0 % on a 165 px player), so a person box from
      // YOLOX-tiny starts the crop tracker, exactly like the app starts it from a locked / first-detected player.
      if (seeded && finder && !tracker!.box) {
        const b = await finder.find(video);
        if (b) tracker!.box = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
      }
      return clean(await m.detectPosePreciseTracked(video, params, tracker!));
    },
    dispose() { tracker = null; finder?.dispose(); finder = null; },
  };
}

function rtmpose(size: RtmposeSize, opts: { threads?: number; detEvery?: number; proxy?: boolean }): LabEngine {
  const eng = new RtmposeEngine(size, opts);
  return {
    id: size, label: `RTMPose-${size.slice(-1)} (ONNX wasm, tracked crop + YOLOX-tiny)`,
    async init() { const i = await eng.init(); return { ...i }; },
    async detect(video) { return eng.detect(video); },
    dispose() { eng.dispose(); },
  };
}

export const ENGINE_IDS = ['movenet-app-worker', 'movenet-thunder', 'movenet-lightning', 'mp-live-full', 'mp-crop-full', 'mp-crop-seeded', 'mp-crop-heavy', 'rtmpose-t', 'rtmpose-s', 'rtmpose-m'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];
/** The slow, high-accuracy engine the others are compared against (pseudo-truth). */
export const REFERENCE_ENGINE: EngineId = 'mp-crop-heavy';

export function createEngine(id: EngineId, opts: { threads?: number; detEvery?: number; proxy?: boolean } = {}): LabEngine {
  switch (id) {
    case 'movenet-app-worker': return appWorkerMoveNet();
    case 'movenet-thunder': return movenet(id, 'MoveNet Thunder (current live default; tfjs on the main thread here)', 'thunder');
    case 'movenet-lightning': return movenet(id, 'MoveNet Lightning (tfjs, main thread)', 'lightning');
    case 'mp-live-full': return mediapipeLive();
    case 'mp-crop-full': return mediapipeCrop(id, 'MediaPipe optimised (full, tracked crop, IMAGE mode)', 'fast');
    case 'mp-crop-seeded': return mediapipeCrop(id, 'MediaPipe optimised + YOLOX-tiny seed (full, tracked crop)', 'fast', true, opts);
    case 'mp-crop-heavy': return mediapipeCrop(id, 'MediaPipe heavy, tracked crop (AI Track quality) — REFERENCE', 'max', true, opts);
    case 'rtmpose-t': case 'rtmpose-s': case 'rtmpose-m': return rtmpose(id, opts);
  }
}
