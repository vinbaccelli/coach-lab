'use client';

/**
 * AUTO-RACKET DETECTION — D-FINE-N, wrist-gated.
 *
 * WHY A DETECTOR AT ALL, AFTER COCO-SSD FAILED
 * --------------------------------------------
 * samRacket.ts records the measurement that killed the last attempt: COCO-SSD hit
 * 6.7%, and — the part that mattered — 0% on the blurrier half of a swing. A
 * detector that only fires on the frames where the racket is already obvious is
 * useless for a stroboscopic layer, because the interesting frames are exactly
 * the blurred ones.
 *
 * D-FINE-N was measured on the same clip, the same 15 frames, the same capture
 * path and the same 0.10 floor (/dev/racket-dfine-spike vs /dev/racket-coco-test):
 *
 *              COCO-SSD        D-FINE-N
 *   raw hit      6.7%            93.3%
 *   blurry half  0%              87.5%
 *   best score   0.170           0.370
 *
 * The wall is gone. That is the whole reason this file exists.
 *
 * TWO THINGS THE SPIKE LEARNED THAT ARE LOAD-BEARING HERE
 * ------------------------------------------------------
 * 1. RACKETS SCORE LOW. Median confidence 0.163, best 0.370 — nothing like the
 *    0.9 a person scores. So the threshold has to sit at ~0.10, which is deep in
 *    false-positive territory... which is what the wrist gate is for. The gate is
 *    not a nicety; it is the only thing making a 0.10 threshold safe.
 * 2. ORT'S OPTIMIZER BREAKS THIS GRAPH. Session creation fails at EVERY dtype
 *    (q4f16 and fp32 alike) with
 *      "Attempting to get index by a name which does not exist:
 *       InsertedPrecisionFreeCast_… for node: …/self_attn_layer_norm/
 *       Mul/SimplifiedLayerNormFusion/"
 *    That is ORT mangling its own cast bookkeeping while fusing D-FINE's encoder
 *    LayerNorm — a runtime bug in the onnxruntime-web build we ship, not a model
 *    or dtype problem (identical error across dtypes proves it; SAM-2 loads fine
 *    on the same runtime). `SimplifiedLayerNormFusion` is an EXTENDED-level pass,
 *    so `graphOptimizationLevel: 'basic'` skips it and the model loads. Measured,
 *    not guessed. Do not "clean this up" without re-testing the load.
 *
 * SELF-HOSTED, like every other model here — /models/dfine-n/**. The spike loaded
 * from the HF CDN because probes may; production may not.
 *
 * COST, AND WHY THE MODE IS THE OPT-IN
 * ------------------------------------
 * samRacket.ts states that nothing may trigger a SAM encode except actual racket
 * use, because an earlier version pre-encoded every frame in the batch and cost
 * 35–60s to coaches who never touched the feature. That rule still stands and
 * this path honours it rather than bending it: auto-racket runs ONLY in the
 * implement modes, where segmenting the implement IS the job the coach selected.
 * Detection is also ordered FIRST so the expensive encode is paid only on frames
 * that actually contain a wrist-gated racket — a frame with no racket costs one
 * ~400ms detection and no SAM at all.
 */

import { poseScaleUnit } from '@/lib/stroMotionDraft/skeletonMaskFilter';
import type { SamPromptBox } from '@/lib/stroMotionDraft/samRacket';

/** transformers.js is dynamically imported — it must never enter the main bundle. */
type Tjs = typeof import('@huggingface/transformers');

/**
 * Elongated sport implements COCO can localize. 'baseball bat' is kept for the
 * same reason the old probe kept it: a racket seen end-on, or blurred into a
 * smear, is regularly classified as a bat, and it generalises the feature to
 * other implements at zero cost.
 */
const IMPLEMENT_CLASSES = new Set(['tennis racket', 'baseball bat']);

/**
 * Detection floor. Deliberately far below a normal detector threshold — see the
 * measured score distribution in the header. Everything above this is then
 * filtered by geometry rather than by confidence.
 */
const MIN_SCORE = 0.1;

/**
 * WRIST GATE, in multiples of the athlete's `unit` (shoulder width).
 *
 * Scaled by the athlete rather than in pixels so it reads the same near or far
 * from camera, and it reuses `poseScaleUnit` — the same scale the zone, the head
 * oval and the segmenter crop are built from, including the batch floor — so this
 * gate cannot drift away from the rest of the pipeline.
 *
 * SIZED FROM MEASUREMENT, NOT ANATOMY. On Vin's real swing frames the correct
 * detections sat 34–119px from a wrist against a batch unit of ~46px, i.e. up to
 * ~2.6 units. 3.0 leaves headroom above the worst real case. It is generous on
 * purpose and still discriminates enormously: the stray detections measured on
 * the same footage were 7.8–118 FOREARMS away, off in another part of the frame
 * entirely. The gate is here to reject those, not to shave the true positives.
 */
const WRIST_GATE_UNITS = 3.0;

/** Fallback gate when the pose is too weak to give a unit, as a frame-diagonal fraction. */
const WRIST_GATE_DIAG_FRACTION = 0.22;

/** COCO-17 wrist indices. */
const L_WRIST = 9, R_WRIST = 10;
/** Repo-wide joint visibility gate (matches MIN_POSE_SCORE). */
const MIN_KP_SCORE = 0.2;

interface NormKp { x: number; y: number; score: number; name?: string }

export interface RacketDetection {
  /** Full-frame video pixels, the space SAM's box prompt wants. */
  box: SamPromptBox;
  cls: string;
  score: number;
  /** Box centre → nearer wrist, in px and in `unit`s. Logged for retuning. */
  wristDistPx: number;
  wristDistUnits: number | null;
  /** How many implement-class detections were seen / survived the gate. */
  candidates: number;
  gated: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model session (one per tab)
// ─────────────────────────────────────────────────────────────────────────────

interface DetectSession {
  model: any;
  processor: any;
  id2label: Record<string, string>;
  device: 'webgpu' | 'wasm';
}

let sessionPromise: Promise<DetectSession | null> | null = null;
let loadedDevice: 'webgpu' | 'wasm' | null = null;

export function racketDetectDevice(): 'webgpu' | 'wasm' | null {
  return loadedDevice;
}

async function getSession(): Promise<DetectSession | null> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      const tjs: Tjs = await import('@huggingface/transformers');
      const { env, AutoModelForObjectDetection, AutoProcessor } = tjs as any;

      // SELF-HOSTED. Remote loading is switched OFF rather than merely unused, so
      // a missing local file fails loudly here instead of silently reaching for
      // the HuggingFace CDN in a coach's browser. Same doctrine as samRacket.
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = '/models/';
      if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/';

      // WebGPU needs shader-f16 for these weights, checked UP FRONT — an adapter
      // can expose WebGPU and still fail session creation on fp16 shaders
      // (measured on Intel gen-9). Identical reasoning to samRacket.getSession.
      let device: 'webgpu' | 'wasm' = 'wasm';
      if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter();
          if (adapter?.features?.has('shader-f16')) device = 'webgpu';
          else console.warn('[autoRacket] WebGPU adapter lacks shader-f16 — using wasm EP (~580ms/frame vs ~200-400ms)');
        } catch (e) {
          console.warn('[autoRacket] WebGPU adapter probe failed — using wasm EP:', e);
        }
      }

      // graphOptimizationLevel:'basic' is REQUIRED — see the ORT note in the
      // header. Without it this model does not load at all, on any dtype.
      const opts = (d: 'webgpu' | 'wasm') => ({
        dtype: 'q4f16',
        device: d,
        session_options: { graphOptimizationLevel: 'basic' },
      });

      const t0 = performance.now();
      let model: any;
      try {
        model = await AutoModelForObjectDetection.from_pretrained('dfine-n', opts(device));
      } catch (e) {
        if (device === 'webgpu') {
          console.warn('[autoRacket] WebGPU load failed, falling back to wasm:', e);
          device = 'wasm';
          model = await AutoModelForObjectDetection.from_pretrained('dfine-n', opts(device));
        } else {
          throw e;
        }
      }
      const processor = await AutoProcessor.from_pretrained('dfine-n');
      const id2label = (model.config?.id2label ?? {}) as Record<string, string>;
      console.log(
        `[autoRacket] D-FINE-N q4f16 ready in ${(performance.now() - t0).toFixed(0)}ms ` +
        `(${device}, self-hosted /models/dfine-n)`,
      );
      return { model, processor, id2label, device } as DetectSession;
    } catch (e) {
      console.warn('[autoRacket] detector load failed — auto-racket unavailable:', e);
      // Null out so a later attempt can retry rather than being stuck on a
      // rejected promise for the life of the tab.
      sessionPromise = null;
      return null;
    }
  })();
  return sessionPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

/** AutoProcessor may hand back the image processor itself or a wrapper. */
function postProcess(processor: any, outputs: any, threshold: number, h: number, w: number) {
  const fn =
    processor.post_process_object_detection?.bind(processor) ??
    processor.image_processor?.post_process_object_detection?.bind(processor.image_processor);
  if (!fn) throw new Error('processor exposes no post_process_object_detection');
  // target_sizes is [[height, width]] — post_process scales x by target[1] and y
  // by target[0], so the order is not interchangeable.
  return fn(outputs, threshold, [[h, w]])[0];
}

function wrist(kps: NormKp[] | null | undefined, idx: number, vw: number, vh: number) {
  const k = kps?.[idx];
  if (!k || k.score < MIN_KP_SCORE) return null;
  return { x: k.x * vw, y: k.y * vh };
}

/**
 * Detect the implement on ONE frame and return the best WRIST-GATED box.
 *
 * Returns null for every failure and every empty result — model unavailable, no
 * detection, nothing near a hand. Null means "no racket on this frame", which the
 * caller treats as "leave the mask alone and let the coach click", never as an
 * error. That is the same fail-closed rule the motion-diff racket candidate uses:
 * no racket beats a wrong racket, because a wrong box would be handed to SAM and
 * come back as a confident, precisely-segmented piece of the court.
 */
export async function detectRacketBox(args: {
  frame: ImageBitmap | HTMLCanvasElement;
  keypoints: NormKp[] | null | undefined;
  vw: number;
  vh: number;
  unitFloorNorm?: number | null;
  /** For the log line only. */
  label?: string;
}): Promise<RacketDetection | null> {
  const { frame, keypoints, vw, vh } = args;
  const tag = args.label ?? '';

  const session = await getSession();
  if (!session) return null;
  loadedDevice = session.device;

  const tjs: Tjs = await import('@huggingface/transformers');
  const { RawImage } = tjs as any;

  // RawImage wants a canvas; an ImageBitmap is drawn once into one.
  let canvas: HTMLCanvasElement;
  if (frame instanceof HTMLCanvasElement) {
    canvas = frame;
  } else {
    canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')!.drawImage(frame, 0, 0);
  }

  const t0 = performance.now();
  const image = RawImage.fromCanvas(canvas).rgb();
  const inputs = await session.processor(image);
  const outputs = await session.model(inputs);
  const { boxes, classes, scores } = postProcess(
    session.processor, outputs, MIN_SCORE, canvas.height, canvas.width,
  );
  const ms = performance.now() - t0;

  // Implement-class candidates only.
  const cands: Array<{ box: SamPromptBox; cls: string; score: number }> = [];
  for (let i = 0; i < scores.length; i++) {
    const cls = session.id2label[String(classes[i])] ?? '';
    if (!IMPLEMENT_CLASSES.has(cls)) continue;
    const [x0, y0, x1, y1] = boxes[i] as number[];
    cands.push({
      cls,
      score: scores[i],
      box: {
        x1: Math.max(0, Math.min(x0, x1)),
        y1: Math.max(0, Math.min(y0, y1)),
        x2: Math.min(vw, Math.max(x0, x1)),
        y2: Math.min(vh, Math.max(y0, y1)),
      },
    });
  }

  // ── WRIST GATE ────────────────────────────────────────────────────────────
  const wl = wrist(keypoints, L_WRIST, vw, vh);
  const wr = wrist(keypoints, R_WRIST, vw, vh);
  const scale = keypoints ? poseScaleUnit(keypoints, vw, vh, args.unitFloorNorm ?? null) : null;
  const unit = scale?.unit ?? null;
  const limit = unit
    ? unit * WRIST_GATE_UNITS
    : Math.hypot(vw, vh) * WRIST_GATE_DIAG_FRACTION;

  const gated: Array<RacketDetection> = [];
  for (const c of cands) {
    const cx = (c.box.x1 + c.box.x2) / 2;
    const cy = (c.box.y1 + c.box.y2) / 2;
    const ds: number[] = [];
    if (wl) ds.push(Math.hypot(cx - wl.x, cy - wl.y));
    if (wr) ds.push(Math.hypot(cx - wr.x, cy - wr.y));
    // NO WRISTS ⇒ NO GATE ⇒ NO RACKET. Accepting an ungated detection here would
    // hand SAM a box chosen by a 0.10-confidence classifier alone, which is
    // exactly the false-positive case the gate exists to stop.
    if (!ds.length) continue;
    const d = Math.min(...ds);
    if (d > limit) continue;
    gated.push({
      box: c.box,
      cls: c.cls,
      score: c.score,
      wristDistPx: d,
      wristDistUnits: unit ? d / unit : null,
      candidates: cands.length,
      gated: 0,
    });
  }

  // Highest confidence among those near a hand — the brief's tie-break, and the
  // right one: proximity has already been reduced to a yes/no by the gate, so
  // ranking by distance after that would prefer a worse detection for being
  // marginally closer to the wrist.
  gated.sort((a, b) => b.score - a.score);
  const best = gated[0] ?? null;
  if (best) best.gated = gated.length;

  console.log(
    `[autoRacket] ${tag} detect ${ms.toFixed(0)}ms — ${cands.length} implement cand(s), ` +
    `${gated.length} near a wrist (limit ${limit.toFixed(0)}px, unit=${unit?.toFixed(0) ?? 'n/a'}px) → ` +
    (best
      ? `${best.cls} s=${best.score.toFixed(3)} box=${best.box.x1.toFixed(0)},${best.box.y1.toFixed(0)}→` +
        `${best.box.x2.toFixed(0)},${best.box.y2.toFixed(0)} wrist=${best.wristDistPx.toFixed(0)}px` +
        `${best.wristDistUnits ? ` (${best.wristDistUnits.toFixed(1)}u)` : ''}`
      : 'NONE — frame keeps the manual click path'),
  );

  return best;
}
