/**
 * RTMPose spike — browser engine (onnxruntime-web, wasm EP). Top-down: a person box (YOLOX-tiny on the first frame / when
 * lost, then the previous frame's joints) → 192×256 crop → RTMPose SimCC → 17 COCO keypoints in video pixels.
 * Weights are self-hosted (public/models/rtmpose/), the wasm runtime is the one staged in public/ort/.
 * NOT wired into the analysis page — only the lab page (/rtmpose-lab) uses it in this spike.
 */
import { retryImport as R } from './retryImport';
import { IN_W, IN_H, cropFromBox, rgbaCropToTensor, decodeSimcc, boxFromKeypoints, bestPerson, rgba416ToYoloxTensor, type Box, type Kp } from './core';

export type RtmposeSize = 'rtmpose-t' | 'rtmpose-s' | 'rtmpose-m';
type Ort = typeof import('onnxruntime-web/wasm');

export interface RtmposeInfo { threads: number; crossOriginIsolated: boolean; ep: string; proxyWorker: boolean; loadMs: number }

/** YOLOX-tiny person finder (shared by RTMPose and by the YOLOX-seeded MediaPipe variant in the lab). */
async function fetchModel(url: string, tries = 4): Promise<Uint8Array> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 400 * (i + 1))); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Run ORT's wasm in its own worker so inference never blocks the page (matters when SharedArrayBuffer threads are unavailable, e.g. iPhone). */
function configureOrt(ort: Ort, opts: { threads?: number; proxy?: boolean }) {
  const env = ort.env;
  env.wasm.wasmPaths = '/ort/';
  const iso = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const threads = opts.threads ?? (iso ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))) : 1);
  env.wasm.numThreads = threads;
  env.wasm.proxy = !!opts.proxy;
  return { iso, threads };
}

export class PersonFinder {
  private ort!: Ort;
  private det!: import('onnxruntime-web/wasm').InferenceSession;
  private canvas: HTMLCanvasElement | null = null;
  async init(ort?: Ort, opts: { threads?: number; proxy?: boolean } = {}) {
    this.ort = ort ?? (await R(() => import('onnxruntime-web/wasm')));
    if (!ort) configureOrt(this.ort, opts);
    this.det = await this.ort.InferenceSession.create(await fetchModel('/models/rtmpose/yolox-tiny.onnx'), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  async find(video: HTMLVideoElement, prefer?: Box | null): Promise<Box | null> {
    const W = video.videoWidth, H = video.videoHeight, S = 416;
    const c = (this.canvas ??= Object.assign(document.createElement('canvas'), { width: S, height: S }));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const scale = Math.min(S / W, S / H);
    ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(video, 0, 0, Math.round(W * scale), Math.round(H * scale));
    const tensor = rgba416ToYoloxTensor(ctx.getImageData(0, 0, S, S).data, S);
    const r = await this.det.run({ input: new this.ort.Tensor('float32', tensor, [1, 3, S, S]) });
    return bestPerson(r.dets.data as Float32Array, r.labels.data as unknown as ArrayLike<number | bigint>, scale, 0.3, prefer ?? undefined);
  }
  dispose() { void this.det?.release?.(); }
}

export class RtmposeEngine {
  private ort!: Ort;
  private pose!: import('onnxruntime-web/wasm').InferenceSession;
  private finder = new PersonFinder();
  private crop = document.createElement('canvas');
  private cctx!: CanvasRenderingContext2D;
  private box: Box | null = null;
  private frameNo = 0;
  info!: RtmposeInfo;
  /** ms spent in the person detector on the last detect() call (0 when the tracked box was used). */
  lastDetMs = 0;
  detections = 0;

  constructor(private size: RtmposeSize, private opts: { threads?: number; detEvery?: number; proxy?: boolean } = {}) {}

  async init(): Promise<RtmposeInfo> {
    const t0 = performance.now();
    this.ort = await R(() => import('onnxruntime-web/wasm')); // wasm-only build: asks for ort-wasm-simd-threaded.wasm, which is staged in public/ort
    const { iso, threads } = configureOrt(this.ort, this.opts);
    const so = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const };
    this.pose = await this.ort.InferenceSession.create(await fetchModel(`/models/rtmpose/${this.size}.onnx`), so);
    await this.finder.init(this.ort);
    this.crop.width = IN_W; this.crop.height = IN_H;
    this.cctx = this.crop.getContext('2d', { willReadFrequently: true })!;
    this.info = { threads, crossOriginIsolated: iso, ep: 'wasm', proxyWorker: !!this.opts.proxy, loadMs: performance.now() - t0 };
    return this.info;
  }

  reset() { this.box = null; this.frameNo = 0; }


  /** One pose for the CURRENT video frame, or null when no person was found. */
  async detect(video: HTMLVideoElement): Promise<Kp[] | null> {
    this.lastDetMs = 0;
    const every = this.opts.detEvery ?? 0;
    if (!this.box || (every > 0 && this.frameNo % every === 0)) {
      const t0 = performance.now();
      const b = await this.finder.find(video, this.box);
      this.lastDetMs = performance.now() - t0;
      if (b) { this.box = b; this.detections++; }
    }
    this.frameNo++;
    if (!this.box) return null;
    const c = cropFromBox(this.box);
    const a = IN_W / c.sw, d = IN_H / c.sh;
    const ctx = this.cctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, IN_W, IN_H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(a, 0, 0, d, -(c.cx - c.sw / 2) * a, -(c.cy - c.sh / 2) * d);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tensor = rgbaCropToTensor(ctx.getImageData(0, 0, IN_W, IN_H).data);
    const out = await this.pose.run({ input: new this.ort.Tensor('float32', tensor, [1, 3, IN_H, IN_W]) });
    const kps = decodeSimcc(out.simcc_x.data as Float32Array, out.simcc_y.data as Float32Array, c);
    this.box = boxFromKeypoints(kps); // null ⇒ re-detect next frame
    return kps;
  }

  dispose() {
    void this.pose?.release?.(); this.finder.dispose();
    this.box = null;
  }
}
