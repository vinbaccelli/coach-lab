'use client';

/**
 * TEMP-DEBUG-DFINE — THROWAWAY SPIKE HARNESS. DELETE WITH THIS TAG.
 *
 * Not a feature, not wired to Motion Layer, imported by nothing. It answers one
 * gating question with a number:
 *
 *   Does D-FINE-N detect the tennis racket on Vin's REAL swing frames — better
 *   than the 6.7% hit rate COCO-SSD managed (documented in samRacket.ts)?
 *
 * If yes, the plan is detector box → the EXISTING SAM-2 (`decodeSamPrompt`-style
 * `input_boxes`) → the existing edit panel. If no, auto-racket hits the same
 * motion-blur wall COCO-SSD did and the click path stays the answer. NOTHING is
 * built until this page produces the number.
 *
 * ── APPLES TO APPLES ────────────────────────────────────────────────────────
 * The comparison is only worth anything if the two harnesses measure the same
 * thing, so the methodology here is lifted from /dev/racket-coco-test — the page
 * that produced the 6.7%:
 *   - same frame sampling (evenly spaced over [start,end], default 15 = the
 *     Motion Layer batch size),
 *   - same capture path (`createCaptureSource`'s private element + the
 *     `normalizedFrameBitmap` re-grab replicated statement-for-statement),
 *   - same implement classes ('tennis racket' + 'baseball bat'),
 *   - same deliberately-low 0.1 score floor, so weak detections are COUNTED
 *     rather than filtered away before they can be seen,
 *   - same hit definition — a frame "hits" when at least one implement-class box
 *     fires — and the same sharp/blurry split on the median variance-of-Laplacian
 *     inside the skeleton racket zone.
 * The duplication is deliberate: this file is throwaway, and importing from the
 * other probe would couple two things that both want to be deletable.
 *
 * ── WHAT THIS ADDS OVER THE COCO PROBE ──────────────────────────────────────
 *   - personHitRate: the HARNESS SANITY CHECK. If D-FINE finds a person on every
 *     frame but no racket, the model works and the racket is genuinely
 *     undetectable — a real finding. If it finds NOTHING, the harness is broken
 *     and no conclusion may be drawn from the racket number. Those two outcomes
 *     look identical in a hit rate alone, so they are separated here.
 *   - the WRIST GATE: a racket is held, so a box far from both wrists is a false
 *     positive. Distances are reported RAW (in px and in forearm-lengths) as well
 *     as gated, so the threshold can be re-tuned from the JSON without re-running.
 *
 * ── ENV NOTE ────────────────────────────────────────────────────────────────
 * This probe loads from the HF CDN, exactly as /dev/sam-probe does; production
 * self-hosts under /models/. `env` is a module-level singleton shared with
 * samRacket.ts, which sets allowRemoteModels=false when the racket tool loads —
 * so both are set explicitly here rather than inherited. Running this page and
 * the racket tool in the SAME tab is not supported; use a fresh tab.
 */

import React, { useCallback, useRef, useState } from 'react';
import { createCaptureSource, type CaptureSource } from '@/lib/stroMotionDraft';
import { estimateTennisRacketZones, type StroMotionPoseKeypoint } from '@/lib/stroMotionPose';

const DEV = process.env.NODE_ENV !== 'production';

/** The number this spike has to beat, from samRacket.ts's header. */
const COCO_SSD_BASELINE_HIT_RATE = 0.067;

/** Same set the COCO probe counted — a racket seen end-on reads as a bat. */
const IMPLEMENT_CLASSES = new Set(['tennis racket', 'baseball bat']);

/** Below production floors on purpose — see the header. */
const PROBE_MIN_SCORE = 0.1;

/**
 * Wrist gate, in FOREARM LENGTHS from the nearer wrist to the box centre.
 *
 * Scaled by the athlete's own forearm rather than by pixels so it reads the same
 * whether they are near or far from the camera. A racket is ~2.2 forearms long
 * and is held at one end, so its box centre sits ~1.1 forearms from the wrist;
 * 2.5 leaves room for a long box on a blurred smear without admitting a
 * detection on the other side of the court.
 */
const WRIST_GATE_FOREARMS = 2.5;
/** Fallback when no forearm is measurable, as a fraction of the frame diagonal. */
const WRIST_GATE_DIAG_FRACTION = 0.22;

const MODEL_CANDIDATES = [
  // No slash ⇒ SELF-HOSTED under /models/, i.e. the exact configuration
  // production (racketDetect.ts) uses. Listed first so the default run validates
  // what actually ships rather than the CDN copy.
  'dfine-n',
  'onnx-community/dfine_n_coco-ONNX',
  'onnx-community/dfine_s_coco-ONNX',
  'onnx-community/dfine_m_coco-ONNX',
  'onnx-community/rtdetr_v2_r18vd-ONNX',
];

const DTYPES = ['q4f16', 'fp16', 'q8', 'fp32'];

/** ORT graph-optimization levels — see the measured note in getDetector. */
const GRAPH_OPTS = ['default', 'basic', 'disabled', 'extended', 'all'];

interface Det {
  cls: string;
  score: number;
  /** [x0, y0, x1, y1] in the normalized frame's own pixel space. */
  box: [number, number, number, number];
}

interface Kp { x: number; y: number; score: number; name: string }

interface FrameRow {
  i: number;
  t: number;
  frameW: number;
  frameH: number;
  blurFrame: number | null;
  blurZone: number | null;
  /** Every detection at or above PROBE_MIN_SCORE — false positives included. */
  dets: Det[];
  /** Implement-class subset, best-first. */
  rackets: Det[];
  personBest: number | null;
  wristL: Kp | null;
  wristR: Kp | null;
  forearmPx: number | null;
  /** Box centre → nearer wrist, in px, for the BEST implement detection. */
  boxToWristPx: number | null;
  boxToWristForearms: number | null;
  nearWrist: boolean;
  poseOk: boolean;
  ms: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────

interface Detector {
  model: any;
  processor: any;
  id2label: Record<string, string>;
  device: string;
  dtype: string;
  loadMs: number;
}

let cached: { key: string; det: Detector } | null = null;

/**
 * Same shader-f16 capability check samRacket.ts uses, and for the same measured
 * reason: `navigator.gpu` existing is NOT enough — Intel gen-9 exposes WebGPU but
 * cannot compile the fp16 Transpose shader, and session creation dies. Checked up
 * front rather than caught, because the failure is unrecoverable by then.
 */
async function webgpuUsable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) return false;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return !!adapter?.features?.has('shader-f16');
  } catch {
    return false;
  }
}

async function getDetector(
  modelId: string,
  dtype: string,
  deviceChoice: 'auto' | 'webgpu' | 'wasm',
  graphOpt: string,
  say: (s: string) => void,
): Promise<Detector> {
  const key = `${modelId}|${dtype}|${deviceChoice}|${graphOpt}`;
  if (cached?.key === key) return cached.det;

  const tjs = await import('@huggingface/transformers');
  const { env, AutoModelForObjectDetection, AutoProcessor } = tjs as any;

  // A bare id (no slash) is a SELF-HOSTED model under /models/ — production's
  // configuration. Anything with an org prefix is a CDN checkpoint, which a probe
  // may load and production may not. See the ENV NOTE in the header.
  const isLocal = !modelId.includes('/');
  env.allowRemoteModels = !isLocal;
  env.allowLocalModels = isLocal;
  env.localModelPath = '/models/';
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/';

  let device: 'webgpu' | 'wasm';
  if (deviceChoice === 'auto') {
    device = (await webgpuUsable()) ? 'webgpu' : 'wasm';
    if (device === 'wasm') say('WebGPU unavailable or lacks shader-f16 → wasm EP');
  } else {
    device = deviceChoice;
  }

  /**
   * GRAPH OPTIMIZATION LEVEL — not a knob anyone wanted, but a necessary one.
   *
   * MEASURED on this machine: D-FINE fails to create a session on the wasm EP at
   * EVERY dtype (q4f16 and fp32 both), with
   *
   *   "Attempting to get index by a name which does not exist:
   *    InsertedPrecisionFreeCast_/model/Constant_137_output_0
   *    for node: .../self_attn_layer_norm/Mul/SimplifiedLayerNormFusion/"
   *
   * That is ORT's own optimizer breaking its cast bookkeeping while fusing
   * D-FINE's encoder LayerNorm — a runtime bug, not a model or dtype problem
   * (identical error for both dtypes proves it). SAM-2 loads fine on this same
   * ORT, so the runtime is not broken in general; this specific fusion is.
   * `SimplifiedLayerNormFusion` runs at the EXTENDED level, so 'basic' skips it.
   */
  const sessionOptions = graphOpt === 'default' ? undefined : { graphOptimizationLevel: graphOpt };
  const opts = (d: 'webgpu' | 'wasm') => ({
    dtype, device: d, ...(sessionOptions ? { session_options: sessionOptions } : {}),
  });

  say(`loading ${modelId} dtype=${dtype} device=${device} graphOpt=${graphOpt}…`);
  const t0 = performance.now();
  let model: any;
  try {
    model = await AutoModelForObjectDetection.from_pretrained(modelId, opts(device));
  } catch (e) {
    if (device === 'webgpu') {
      say(`WebGPU load failed (${e instanceof Error ? e.message : String(e)}) → retrying on wasm`);
      device = 'wasm';
      model = await AutoModelForObjectDetection.from_pretrained(modelId, opts(device));
    } else {
      throw e;
    }
  }
  const processor = await AutoProcessor.from_pretrained(modelId);
  const loadMs = performance.now() - t0;

  const id2label = (model.config?.id2label ?? {}) as Record<string, string>;
  say(`ready in ${loadMs.toFixed(0)}ms — ${Object.keys(id2label).length} COCO classes`);

  const det: Detector = { model, processor, id2label, device, dtype, loadMs };
  cached = { key, det };
  return det;
}

/** AutoProcessor may hand back the image processor itself or a wrapper. */
function postProcess(processor: any, outputs: any, threshold: number, h: number, w: number) {
  const fn =
    processor.post_process_object_detection?.bind(processor) ??
    processor.image_processor?.post_process_object_detection?.bind(processor.image_processor);
  if (!fn) throw new Error('processor exposes no post_process_object_detection');
  // target_sizes is [[height, width]] — post_process scales x by target[1] and
  // y by target[0], so the order is not interchangeable.
  return fn(outputs, threshold, [[h, w]])[0];
}

async function detectOn(
  det: Detector,
  canvas: HTMLCanvasElement,
  threshold: number,
): Promise<Det[]> {
  const tjs = await import('@huggingface/transformers');
  const { RawImage } = tjs as any;
  const image = RawImage.fromCanvas(canvas).rgb();
  const inputs = await det.processor(image);
  const outputs = await det.model(inputs);
  const { boxes, classes, scores } = postProcess(
    det.processor, outputs, threshold, canvas.height, canvas.width,
  );
  const out: Det[] = [];
  for (let i = 0; i < scores.length; i++) {
    out.push({
      cls: det.id2label[String(classes[i])] ?? `class_${classes[i]}`,
      score: scores[i],
      box: boxes[i] as [number, number, number, number],
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — replicated from /dev/racket-coco-test so the two measure alike
// ─────────────────────────────────────────────────────────────────────────────

function laplacianVariance(
  data: Uint8ClampedArray, w: number, h: number,
  x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1,
): number | null {
  const ax0 = Math.max(1, Math.floor(x0));
  const ay0 = Math.max(1, Math.floor(y0));
  const ax1 = Math.min(w - 2, Math.ceil(x1));
  const ay1 = Math.min(h - 2, Math.ceil(y1));
  if (ax1 <= ax0 || ay1 <= ay0) return null;
  const lum = (i: number) =>
    0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      const i = y * w + x;
      const lap = 4 * lum(i) - lum(i - 1) - lum(i + 1) - lum(i - w) - lum(i + w);
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n < 16) return null;
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 100) / 100;
}

async function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(
    0,
    Math.min(timeSec, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1e-6) : timeSec),
  );
  video.pause();
  if (Math.abs(video.currentTime - target) < 0.001) return;
  await new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = target;
    window.setTimeout(done, 3000);
  });
}

/** The shipped `normalizedFrameBitmap` re-grab — draw from the ELEMENT. */
function grabNormalized(video: HTMLVideoElement, into: HTMLCanvasElement): void {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const ctx = into.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  into.width = w;
  into.height = h;
  ctx.drawImage(video, 0, 0, w, h);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RacketDfineSpikePage() {
  const [modelId, setModelId] = useState(MODEL_CANDIDATES[0]);
  const [dtype, setDtype] = useState('q4f16');
  const [deviceChoice, setDeviceChoice] = useState<'auto' | 'webgpu' | 'wasm'>('auto');
  const [graphOpt, setGraphOpt] = useState('default');
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcLabel, setSrcLabel] = useState('(none)');
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(2);
  const [frameCount, setFrameCount] = useState(15);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const thumbsRef = useRef<HTMLDivElement | null>(null);

  const say = useCallback((s: string) => {
    setLog((prev) => [...prev, s]);
    // eslint-disable-next-line no-console
    console.log('[dfine-spike]', s);
  }, []);

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    setSrcUrl(URL.createObjectURL(f));
    setSrcLabel(f.name);
  }, []);

  /**
   * STEP 1 — SMOKE TEST. No video required.
   *
   * Answers "can the pinned transformers.js load and run D-FINE at all" before
   * anyone spends time wiring footage into it. A synthetic frame is the RIGHT
   * input here and only here: this measures the LOAD and the FORWARD PASS, not
   * detection quality, and a blank canvas cannot flatter either. It deliberately
   * reports whatever the model says about a grey rectangle — usually nothing,
   * which is the correct answer and still proves the pipeline runs end to end.
   */
  const runSmoke = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setLog([]);
    setSummary(null);
    try {
      const det = await getDetector(modelId, dtype, deviceChoice, graphOpt, say);

      const cnv = document.createElement('canvas');
      cnv.width = 640;
      cnv.height = 640;
      const ctx = cnv.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#6a7a8a';
      ctx.fillRect(0, 0, 640, 640);
      ctx.fillStyle = '#20303f';
      ctx.fillRect(240, 120, 160, 400);

      // Two passes: the first includes ORT graph warm-up, the second is the
      // steady-state number a batch would actually pay per frame.
      const t1 = performance.now();
      const first = await detectOn(det, cnv, 0.05);
      const firstMs = performance.now() - t1;
      const t2 = performance.now();
      const second = await detectOn(det, cnv, 0.05);
      const secondMs = performance.now() - t2;

      const sum = {
        verdict: 'LOADED AND RAN — the pinned transformers.js can drive this model',
        modelId,
        dtype,
        device: det.device,
        graphOpt,
        transformersVersion: (await import('@huggingface/transformers') as any).env?.version ?? 'unknown',
        cocoClasses: Object.keys(det.id2label).length,
        hasTennisRacketClass: Object.values(det.id2label).includes('tennis racket'),
        hasBaseballBatClass: Object.values(det.id2label).includes('baseball bat'),
        loadMs: Math.round(det.loadMs),
        firstInferenceMs: Math.round(firstMs),
        warmInferenceMs: Math.round(secondMs),
        detectionsOnSyntheticFrame: first.length,
        note:
          'A grey rectangle is not a test of detection quality — it proves the ' +
          'load + forward pass + post-process chain runs. Real numbers come from ' +
          'the frame run below.',
        _secondPassDets: second.length,
      };
      setSummary(sum);
      (window as unknown as Record<string, unknown>).__dfineSmoke = sum;
      // eslint-disable-next-line no-console
      console.log('[dfine-spike] SMOKE', sum);
      say(`SMOKE OK — load ${sum.loadMs}ms, warm inference ${sum.warmInferenceMs}ms on ${det.device}`);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setSummary({ verdict: 'FAILED TO LOAD', modelId, dtype, error: msg });
      say(`SMOKE FAILED: ${msg}`);
      // eslint-disable-next-line no-console
      console.error('[dfine-spike]', e);
    } finally {
      setBusy(false);
    }
  }, [busy, modelId, dtype, deviceChoice, graphOpt, say]);

  /** STEP 2 — the real measurement, on real frames. */
  const runFrames = useCallback(async () => {
    if (!srcUrl || busy) return;
    setBusy(true);
    setLog([]);
    setSummary(null);
    if (thumbsRef.current) thumbsRef.current.innerHTML = '';

    let source: CaptureSource | null = null;
    const out: FrameRow[] = [];

    try {
      const det = await getDetector(modelId, dtype, deviceChoice, graphOpt, say);

      source = createCaptureSource(srcUrl);
      await source.ready(20000);
      const el = source.element;
      say(`source ready: ${el.videoWidth}x${el.videoHeight}, duration ${el.duration.toFixed(2)}s`);

      const { acquirePoseDetector } = await import('@/lib/sharedPoseDetector');
      const poseDet = await acquirePoseDetector();
      say('pose detector ready');

      const a = Math.max(0, Math.min(startSec, endSec));
      const b = Math.max(a + 0.001, Math.max(startSec, endSec));
      const N = Math.max(1, Math.min(60, Math.round(frameCount)));

      const cnv = document.createElement('canvas');

      for (let i = 0; i < N; i++) {
        const t = N === 1 ? a : a + ((b - a) * i) / (N - 1);
        const t0 = performance.now();

        await seekTo(el, t);
        grabNormalized(el, cnv);
        const ctx = cnv.getContext('2d', { willReadFrequently: true })!;
        const img = ctx.getImageData(0, 0, cnv.width, cnv.height);

        const dets = await detectOn(det, cnv, PROBE_MIN_SCORE);
        const rackets = dets.filter((d) => IMPLEMENT_CLASSES.has(d.cls));
        const personBest = dets.find((d) => d.cls === 'person')?.score ?? null;

        // Frame-exact pose on the SAME bitmap the detector just saw.
        let kps: Kp[] = [];
        try {
          const poses = await poseDet.estimatePoses(cnv as unknown as HTMLCanvasElement, { flipHorizontal: false });
          const raw = poses?.[0]?.keypoints as Array<{ x: number; y: number; score?: number; name?: string }> | undefined;
          kps = (raw ?? []).map((k) => ({ x: k.x, y: k.y, score: k.score ?? 0, name: k.name ?? '' }));
        } catch { /* pose failure is data, not a crash */ }

        const wristL = kps[9] ?? null;
        const wristR = kps[10] ?? null;
        const elbowL = kps[7] ?? null;
        const elbowR = kps[8] ?? null;
        const poseOk = kps.length >= 17;

        const foreL = wristL && elbowL && wristL.score >= 0.2 && elbowL.score >= 0.2
          ? Math.hypot(wristL.x - elbowL.x, wristL.y - elbowL.y) : 0;
        const foreR = wristR && elbowR && wristR.score >= 0.2 && elbowR.score >= 0.2
          ? Math.hypot(wristR.x - elbowR.x, wristR.y - elbowR.y) : 0;
        const forearmPx = Math.max(foreL, foreR) || null;

        // Skeleton racket zone — only for the sharpness split, same as the COCO probe.
        let zone: { x0: number; y0: number; x1: number; y1: number } | null = null;
        if (poseOk) {
          const px: StroMotionPoseKeypoint[] = kps.map((k) => ({ x: k.x, y: k.y, score: k.score, name: k.name }));
          const combined = estimateTennisRacketZones(px, cnv.width, cnv.height).combined;
          if (combined) zone = { x0: combined.x0, y0: combined.y0, x1: combined.x1, y1: combined.y1 };
        }

        const blurFrame = laplacianVariance(img.data, cnv.width, cnv.height);
        const blurZone = zone
          ? laplacianVariance(img.data, cnv.width, cnv.height, zone.x0, zone.y0, zone.x1, zone.y1)
          : null;

        // Wrist gate on the BEST implement detection.
        let boxToWristPx: number | null = null;
        let boxToWristForearms: number | null = null;
        let nearWrist = false;
        if (rackets.length) {
          const [x0, y0, x1, y1] = rackets[0].box;
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          const ds: number[] = [];
          for (const wr of [wristL, wristR]) {
            if (wr && wr.score >= 0.2) ds.push(Math.hypot(cx - wr.x, cy - wr.y));
          }
          if (ds.length) {
            boxToWristPx = Math.min(...ds);
            const limit = forearmPx
              ? forearmPx * WRIST_GATE_FOREARMS
              : Math.hypot(cnv.width, cnv.height) * WRIST_GATE_DIAG_FRACTION;
            if (forearmPx) boxToWristForearms = boxToWristPx / forearmPx;
            nearWrist = boxToWristPx <= limit;
          }
        }

        const ms = Math.round(performance.now() - t0);
        out.push({
          i, t, frameW: cnv.width, frameH: cnv.height, blurFrame, blurZone,
          dets, rackets, personBest, wristL, wristR, forearmPx,
          boxToWristPx, boxToWristForearms, nearWrist, poseOk, ms,
        });

        // Annotated thumbnail — the eyeball check on "is the box ON the racket".
        if (thumbsRef.current) {
          const th = document.createElement('canvas');
          const TW = 260;
          const k = TW / cnv.width;
          th.width = TW;
          th.height = Math.round(cnv.height * k);
          const tc = th.getContext('2d');
          if (tc) {
            tc.drawImage(cnv, 0, 0, th.width, th.height);
            for (const d of dets) {
              const imp = IMPLEMENT_CLASSES.has(d.cls);
              tc.strokeStyle = imp ? '#c04cff' : 'rgba(255,255,255,0.35)';
              tc.lineWidth = imp ? 2 : 1;
              tc.strokeRect(d.box[0] * k, d.box[1] * k, (d.box[2] - d.box[0]) * k, (d.box[3] - d.box[1]) * k);
              if (imp) {
                tc.fillStyle = '#c04cff';
                tc.font = '11px monospace';
                tc.fillText(`${d.cls} ${d.score.toFixed(2)}`, d.box[0] * k + 2, d.box[1] * k - 2);
              }
            }
            for (const wr of [wristL, wristR]) {
              if (!wr || wr.score < 0.2) continue;
              tc.fillStyle = '#00ff66';
              tc.beginPath();
              tc.arc(wr.x * k, wr.y * k, 3, 0, Math.PI * 2);
              tc.fill();
            }
          }
          const cell = document.createElement('div');
          cell.style.cssText = 'display:inline-block;margin:4px;vertical-align:top;font:11px monospace;color:#ccc';
          const cap = document.createElement('div');
          cap.textContent =
            `#${i} t=${t.toFixed(2)} racket=${rackets.length ? rackets[0].score.toFixed(2) : '—'}` +
            `${rackets.length ? (nearWrist ? ' @wrist' : ' STRAY') : ''} zoneSharp=${blurZone?.toFixed(0) ?? '—'}`;
          cell.appendChild(th);
          cell.appendChild(cap);
          thumbsRef.current.appendChild(cell);
        }

        say(
          `#${i} t=${t.toFixed(2)} racket=${rackets[0]?.score.toFixed(3) ?? '—'}` +
          `${rackets.length ? (nearWrist ? ' @wrist' : ' STRAY') : ''}` +
          ` person=${personBest?.toFixed(2) ?? '—'} zoneSharp=${blurZone?.toFixed(1) ?? '—'} (${ms}ms)`,
        );
      }

      // ── Summary ───────────────────────────────────────────────────────────
      const hits = out.filter((r) => r.rackets.length > 0);
      const gatedHits = out.filter((r) => r.rackets.length > 0 && r.nearWrist);
      const scores = hits.map((r) => r.rackets[0].score);
      const sharpVals = out.map((r) => r.blurZone ?? 0).filter((v) => v > 0);
      const sharpMedian = median(sharpVals);
      const sharpFrames = out.filter((r) => (r.blurZone ?? 0) >= sharpMedian);
      const blurFrames = out.filter((r) => (r.blurZone ?? 0) < sharpMedian);
      const rate = (rs: FrameRow[], pred: (r: FrameRow) => boolean) =>
        rs.length ? rs.filter(pred).length / rs.length : 0;

      const hitRate = rate(out, (r) => r.rackets.length > 0);
      const personRate = rate(out, (r) => (r.personBest ?? 0) > 0);

      const sum = {
        // ── the answer ──
        hitRate,
        hitRateWristGated: rate(out, (r) => r.rackets.length > 0 && r.nearWrist),
        cocoSsdBaseline: COCO_SSD_BASELINE_HIT_RATE,
        beatsCocoSsd: hitRate > COCO_SSD_BASELINE_HIT_RATE,
        improvementVsCocoSsd: `${(hitRate / COCO_SSD_BASELINE_HIT_RATE).toFixed(1)}x`,

        // ── HARNESS SANITY: read this BEFORE believing the hit rate ──
        personHitRate: personRate,
        harnessSane: personRate >= 0.8,
        harnessNote:
          personRate >= 0.8
            ? 'Detector finds the athlete on ~every frame, so a low racket rate is a real finding about rackets.'
            : 'Detector is NOT reliably finding even the PERSON — suspect the harness/model, do not conclude anything about rackets.',

        // ── the blur question ──
        zoneSharpnessMedian: sharpMedian,
        hitRateOnSharperHalf: rate(sharpFrames, (r) => r.rackets.length > 0),
        hitRateOnBlurrierHalf: rate(blurFrames, (r) => r.rackets.length > 0),

        // ── precision ──
        strayDetectionFrames: out.filter((r) => r.rackets.length > 0 && !r.nearWrist).length,
        boxToWristForearmsMedian: median(out.map((r) => r.boxToWristForearms ?? 0).filter((v) => v > 0)),
        boxToWristPxMedian: median(out.map((r) => r.boxToWristPx ?? 0).filter((v) => v > 0)),
        wristGateThresholdForearms: WRIST_GATE_FOREARMS,

        // ── scores / cost ──
        scoreMin: scores.length ? Math.min(...scores) : null,
        scoreMedian: scores.length ? median(scores) : null,
        scoreMax: scores.length ? Math.max(...scores) : null,
        perFrameMsMedian: median(out.map((r) => r.ms)),
        loadMs: Math.round(det.loadMs),
        device: det.device,
        dtype: det.dtype,
        graphOpt,
        modelId,

        // ── context ──
        source: srcLabel,
        frames: out.length,
        range: [startSec, endSec],
        poseOkFrames: out.filter((r) => r.poseOk).length,
        classesSeen: Array.from(new Set(out.flatMap((r) => r.dets.map((d) => d.cls)))),
      };

      setSummary(sum);
      (window as unknown as Record<string, unknown>).__dfineResults = { summary: sum, rows: out };
      // eslint-disable-next-line no-console
      console.log('[dfine-spike] SUMMARY', sum);
      // eslint-disable-next-line no-console
      console.log('[dfine-spike] window.__dfineResults is set');
      say(
        `DONE — hitRate=${(hitRate * 100).toFixed(0)}% (coco-ssd was 6.7%) ` +
        `gated=${(sum.hitRateWristGated * 100).toFixed(0)}% ` +
        `sharp=${(sum.hitRateOnSharperHalf * 100).toFixed(0)}% blur=${(sum.hitRateOnBlurrierHalf * 100).toFixed(0)}% ` +
        `person=${(personRate * 100).toFixed(0)}% ${sum.harnessSane ? '' : '← HARNESS SUSPECT'}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      say(`FAILED: ${msg}`);
      // eslint-disable-next-line no-console
      console.error('[dfine-spike]', e);
    } finally {
      source?.dispose();
      setBusy(false);
    }
  }, [srcUrl, srcLabel, startSec, endSec, frameCount, busy, modelId, dtype, deviceChoice, graphOpt, say]);

  if (!DEV) return null;

  const inp: React.CSSProperties = {
    width: 70, background: '#111', color: '#eee', border: '1px solid #444', padding: '2px 4px',
  };
  const sel: React.CSSProperties = {
    background: '#111', color: '#eee', border: '1px solid #444', padding: '2px 4px',
  };
  const btn: React.CSSProperties = {
    background: '#2b6', color: '#000', border: 0, padding: '6px 14px',
    fontWeight: 700, cursor: 'pointer', marginRight: 8,
  };

  return (
    <div style={{ padding: 16, font: '13px monospace', background: '#0b0b0b', color: '#ddd', minHeight: '100vh' }}>
      <h1 style={{ font: '700 16px monospace', color: '#c04cff' }}>
        D-FINE racket-detection spike — TEMP-DEBUG-DFINE (throwaway)
      </h1>
      <p style={{ maxWidth: 900, color: '#aaa' }}>
        Gating question: does D-FINE beat COCO-SSD&apos;s <b>6.7%</b> racket hit rate on real swing
        frames? Same sampling, same capture path, same implement classes and same 0.1 score floor as
        <code> /dev/racket-coco-test</code>, so the two numbers are comparable. Run the smoke test
        first — it needs no video. Results land on <code>window.__dfineResults</code>.
        <br />
        <b style={{ color: '#fc0' }}>Read personHitRate before believing hitRate:</b> if the detector
        is not even finding the athlete, the harness is broken and the racket number means nothing.
      </p>

      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        model
        <select style={sel} value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {MODEL_CANDIDATES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        dtype
        <select style={sel} value={dtype} onChange={(e) => setDtype(e.target.value)}>
          {DTYPES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        device
        <select style={sel} value={deviceChoice} onChange={(e) => setDeviceChoice(e.target.value as 'auto' | 'webgpu' | 'wasm')}>
          <option value="auto">auto</option>
          <option value="webgpu">webgpu</option>
          <option value="wasm">wasm</option>
        </select>
        graphOpt
        <select style={sel} value={graphOpt} onChange={(e) => setGraphOpt(e.target.value)}>
          {GRAPH_OPTS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button style={btn} disabled={busy} onClick={() => { void runSmoke(); }}>
          1. Smoke test (no video)
        </button>
      </div>

      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="video/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        <button style={{ ...btn, background: '#456' , color: '#eee' }} onClick={() => { setSrcUrl('/demo.mp4'); setSrcLabel('/demo.mp4'); }}>
          use /demo.mp4
        </button>
        <span style={{ color: '#888' }}>src: {srcLabel}</span>
      </div>

      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        start <input style={inp} type="number" step="0.1" value={startSec} onChange={(e) => setStartSec(+e.target.value)} />
        end <input style={inp} type="number" step="0.1" value={endSec} onChange={(e) => setEndSec(+e.target.value)} />
        frames <input style={inp} type="number" value={frameCount} onChange={(e) => setFrameCount(+e.target.value)} />
        <button style={btn} disabled={busy || !srcUrl} onClick={() => { void runFrames(); }}>
          2. Run on real frames
        </button>
        {busy && <span style={{ color: '#fc0' }}>running…</span>}
      </div>

      {summary && (
        <pre style={{ background: '#111', border: '1px solid #333', padding: 10, maxHeight: 420, overflow: 'auto' }}>
          {JSON.stringify(summary, null, 2)}
        </pre>
      )}

      <div ref={thumbsRef} style={{ margin: '12px 0' }} />

      <pre style={{ background: '#111', border: '1px solid #333', padding: 10, maxHeight: 300, overflow: 'auto', color: '#9c9' }}>
        {log.join('\n')}
      </pre>
    </div>
  );
}
