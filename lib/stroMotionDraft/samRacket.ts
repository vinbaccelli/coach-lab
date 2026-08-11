'use client';

/**
 * SAM 2 RACKET SEGMENTATION — the promptable segmenter behind Motion Layer's
 * racket tool.
 *
 * WHY THIS EXISTS
 * ---------------
 * The racket is a HELD OBJECT: the skeleton does not track it and the person
 * segmenter excludes it (it is not a person). Every MOTION-BASED auto-detection
 * was measured dead on Vin's real footage — wrist extrapolation painted a
 * phantom, the motion-diff blob caught the moving ARM, the angular-sweep
 * trajectory aliased structurally (Motion Layer frames are ~0.75s apart against
 * a 0.4–0.6s swing that sweeps 180–270°), and COCO-SSD hit 6.7%.
 *
 * SAM 2 is a different KIND of answer: it does not guess where the racket is,
 * it segments what the coach POINTS AT. One click is evidence, not an estimate.
 *
 * ARCHITECTURE — WHY THE ENCODE/DECODE SPLIT MATTERS HERE
 * -------------------------------------------------------
 * SAM splits into a heavy IMAGE ENCODER (once per frame, ~4–9s on a weak Intel
 * GPU) and a light PROMPT DECODER (per click, ~350ms). The encoder runs ONCE per
 * frame, LAZILY — the first time the coach selects the Racket tool on that
 * frame — and every click after that is decoder-only and interactive.
 *
 * It deliberately does NOT run unconditionally in the auto-process batch pass. An
 * earlier version did, on the theory that hiding it inside an existing progress
 * bar was free; instead it loaded the model and encoded every frame on EVERY run
 * whether or not the racket was ever used (~35–60s and ~250MB of embeddings), made
 * the first run look broken while the cached second looked fine, and slowed the
 * app for coaches who never touch the feature. Nothing in this module may be
 * triggered by anything other than actual racket use.
 *
 * THERE ARE NOW TWO THINGS THAT COUNT AS "ACTUAL RACKET USE", and the rule above
 * is unchanged by the second:
 *   1. the coach selects the Racket tool on a frame (the click path), and
 *   2. AUTO-RACKET runs in the batch — but ONLY in the implement object modes,
 *      i.e. only when the coach has already said the implement is the point of
 *      this layer, and only on frames where D-FINE actually found a wrist-gated
 *      racket first. A Player-mode run still touches none of this, and a frame
 *      with no racket in it still pays no encode. See racketDetect.ts.
 *
 * NO CLIENT-SIDE PROPAGATION. SAM 2's video memory-attention is not exportable
 * to ONNX, and it would not help anyway — it assumes temporal continuity, which
 * 0.75s-apart frames do not have. Each frame is segmented independently.
 *
 * SELF-HOSTED, NOT CDN — /models/sam2/** and /ort/**, exactly like
 * /models/selfie_multiclass_256x256.tflite and the pose_landmarker .task files.
 * transformers.js resolves `from_pretrained('sam2')` against env.localModelPath,
 * which already defaults to '/models/'. The feasibility PROBE (/dev/sam-probe)
 * loads from CDN; production does not.
 */

import type { AlphaMask } from '@/lib/stroMotionDraft/types';
// Re-exported so callers can keep importing them from here, while the analysis
// route imports the same two helpers from samRacketKey directly and therefore
// never pulls this module (or transformers.js) into its bundle.
export { racketFrameKey, samRacketEnabled } from '@/lib/stroMotionDraft/samRacketKey';

/** transformers.js is dynamically imported — it must never enter the main bundle. */
type Tjs = typeof import('@huggingface/transformers');

/** A single prompt point, in FULL-FRAME VIDEO PIXELS. label 1 = add, 0 = remove. */
export interface SamPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

export interface SamCandidate {
  /** SAM's own IoU/quality score. NOT a racket-ness score — see pickCandidate. */
  score: number;
  /** Mask coverage as a percentage of the whole frame. */
  areaPct: number;
  /** Whether the mask actually covers the newest positive click. */
  coversClick: boolean;
  /** Null when the plausibility gate vetoed it; the reason is for the log. */
  vetoed: string | null;
}

export interface SamDecodeResult {
  /** Full-frame soft-alpha mask for the CHOSEN candidate. */
  mask: AlphaMask;
  chosen: number;
  candidates: SamCandidate[];
  decodeMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A racket occupies a small slice of frame. Anything above this is the person,
 * the court, or the whole background — the failure mode measured in the probe,
 * where a click one racket-width off returned the ENTIRE CLAY COURT with SAM's
 * HIGHEST score (0.944, against 0.026 for the small correct-scale mask).
 */
const MAX_PLAUSIBLE_AREA_PCT = 12;

/** Below this a "mask" is a speck — a decode that found nothing real. */
const MIN_PLAUSIBLE_AREA_PCT = 0.002;

/** How far from the newest positive click the mask may start, in px. */
const CLICK_TOLERANCE_PX = 6;

/**
 * Logit → alpha ramp width. SAM's decoder emits a CONTINUOUS logit field and
 * only convention binarises it at 0. Ramping 0→2 through a smoothstep keeps
 * genuine partial alpha on motion-blurred racket edges, which is exactly what
 * the soft-alpha contract exists for — better than feathering a binary edge.
 * Same shape as the motion-diff soft alpha in proposeFrameMask.
 */
const LOGIT_SOFT_WIDTH = 2;

/**
 * Embedding-cache budget. Each encoded frame holds three feature tensors
 * (256², 128², 64²) which run to tens of MB, so 15 frames is NOT free. Past the
 * budget the least-recently-used frame is evicted and silently re-encoded if the
 * coach returns to it (~4s), rather than letting the tab OOM.
 */
const CACHE_BUDGET_BYTES = 420 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Model session (one per tab)
// ─────────────────────────────────────────────────────────────────────────────

interface SamSession {
  tjs: Tjs;
  model: any;
  processor: any;
  device: 'webgpu' | 'wasm';
}

let sessionPromise: Promise<SamSession | null> | null = null;

async function getSession(): Promise<SamSession | null> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      const tjs = await import('@huggingface/transformers');
      const { env, Sam2Model, AutoProcessor } = tjs as any;

      // SELF-HOSTED. Remote loading is switched OFF rather than merely unused,
      // so a missing local file fails loudly here instead of silently reaching
      // for the HuggingFace CDN in a coach's browser.
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = '/models/';
      if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/';

      // WebGPU where available; the wasm EP is the honest fallback rather than
      // a hard failure on machines without it.
      //
      // `navigator.gpu` EXISTING IS NOT ENOUGH. The q4f16 weights are fp16, and
      // the WebGPU EP needs the adapter's `shader-f16` feature to compile its
      // Transpose shader. An adapter can expose WebGPU (and crossOriginIsolated +
      // SharedArrayBuffer can both be fine) while still lacking shader-f16 —
      // measured on Intel gen-9 integrated graphics, where session creation dies
      // with "Transpose requires f16 but the device does not support it".
      //
      // The wasm retry below does NOT rescue that case: measured, the retry fails
      // with the IDENTICAL WebGPU f16 error, so by the time the catch runs the
      // load is already unrecoverable and the racket tool reports itself
      // unavailable. Hence the capability is checked UP FRONT and webgpu is never
      // attempted on a device that cannot run these weights.
      let device: 'webgpu' | 'wasm' = 'wasm';
      if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter();
          if (adapter?.features?.has('shader-f16')) {
            device = 'webgpu';
          } else {
            console.warn(
              '[samRacket] WebGPU adapter lacks shader-f16 — using the wasm EP instead ' +
                '(correct, but ~9s per frame encode rather than ~4s)',
            );
          }
        } catch (e) {
          // Adapter probe failed outright — wasm is the safe default.
          console.warn('[samRacket] WebGPU adapter probe failed — using wasm EP:', e);
        }
      }

      let model: any;
      try {
        model = await Sam2Model.from_pretrained('sam2', { dtype: 'q4f16', device });
      } catch (e) {
        if (device === 'webgpu') {
          console.warn('[samRacket] WebGPU load failed, falling back to wasm:', e);
          device = 'wasm';
          model = await Sam2Model.from_pretrained('sam2', { dtype: 'q4f16', device });
        } else {
          throw e;
        }
      }
      const processor = await AutoProcessor.from_pretrained('sam2');
      console.log(`[samRacket] SAM2.1-hiera-tiny q4f16 ready (${device}, self-hosted /models/sam2)`);
      return { tjs, model, processor, device } as SamSession;
    } catch (e) {
      console.warn('[samRacket] model load failed — racket tool unavailable:', e);
      // Null out so a later attempt can retry rather than being stuck on a
      // rejected promise for the life of the tab.
      sessionPromise = null;
      return null;
    }
  })();
  return sessionPromise;
}

// NOTE: there is deliberately NO preload/warm helper here.
//
// One existed and was never called, which was lucky: warming the model ahead of
// use is precisely the mistake the removed batch pre-encode pass made. SAM must
// stay inert — no model, no transformers.js, no ORT wasm, no embeddings — until
// the coach selects the Racket tool on a specific frame. getSession() is reached
// only from encodeFrameForRacket/decodeRacketMask, both of which are only called
// from that path.

export function samRacketDevice(): 'webgpu' | 'wasm' | null {
  return loadedDevice;
}
let loadedDevice: 'webgpu' | 'wasm' | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Per-frame embedding cache
// ─────────────────────────────────────────────────────────────────────────────

interface Encoded {
  key: string;
  emb: Record<string, any>;
  /** processor() output — original_sizes / reshaped_input_sizes for the prompt maths. */
  proc: any;
  width: number;
  height: number;
  bytes: number;
  lastUsed: number;
}

const encodedFrames = new Map<string, Encoded>();
let clock = 0;


export function isFrameEncoded(key: string): boolean {
  return encodedFrames.has(key);
}

export function racketCacheStats(): { frames: number; bytes: number } {
  let bytes = 0;
  encodedFrames.forEach((e) => (bytes += e.bytes));
  return { frames: encodedFrames.size, bytes };
}

/**
 * Drop every cached embedding. Called when a draft is cleared — the tensors are
 * far too large to leak across sessions.
 */
export function clearRacketEncodings(): void {
  encodedFrames.forEach((e) => disposeEmb(e.emb));
  encodedFrames.clear();
  console.log('[samRacket] embedding cache cleared');
}

function disposeEmb(emb: Record<string, any>): void {
  for (const k of Object.keys(emb)) {
    try {
      emb[k]?.dispose?.();
    } catch {
      /* disposal is best-effort — never break the pipeline over it */
    }
  }
}

function evictIfNeeded(): void {
  let { bytes } = racketCacheStats();
  while (bytes > CACHE_BUDGET_BYTES && encodedFrames.size > 1) {
    let oldest: Encoded | null = null;
    encodedFrames.forEach((e) => {
      if (!oldest || e.lastUsed < oldest.lastUsed) oldest = e;
    });
    if (!oldest) break;
    const victim = oldest as Encoded;
    disposeEmb(victim.emb);
    encodedFrames.delete(victim.key);
    bytes -= victim.bytes;
    console.log(`[samRacket] evicted embedding for ${victim.key} (cache budget)`);
  }
}

/**
 * Encode ONE frame. This is the expensive half (~4s on a weak Intel GPU) and is
 * meant to run inside the batch pass, never in response to a click.
 *
 * Returns null when the model is unavailable — the caller treats that as "no
 * racket tool on this frame", never as an error worth aborting the batch for.
 */
export async function encodeFrameForRacket(
  key: string,
  frame: ImageBitmap | HTMLCanvasElement,
): Promise<{ ms: number; bytes: number } | null> {
  const session = await getSession();
  if (!session) return null;
  loadedDevice = session.device;

  const existing = encodedFrames.get(key);
  if (existing) {
    existing.lastUsed = ++clock;
    return { ms: 0, bytes: existing.bytes };
  }

  const { model, processor, tjs } = session;
  const { RawImage } = tjs as any;

  // RawImage wants a canvas; an ImageBitmap is drawn once into one.
  let canvas: HTMLCanvasElement;
  let width: number;
  let height: number;
  if (frame instanceof HTMLCanvasElement) {
    canvas = frame;
    width = frame.width;
    height = frame.height;
  } else {
    width = frame.width;
    height = frame.height;
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(frame, 0, 0);
  }

  const t0 = performance.now();
  const image = RawImage.fromCanvas(canvas).rgb();
  const proc = await processor(image);
  const emb = await model.get_image_embeddings({ pixel_values: proc.pixel_values });
  const ms = performance.now() - t0;

  let bytes = 0;
  for (const k of Object.keys(emb)) bytes += emb[k]?.data?.byteLength ?? 0;

  encodedFrames.set(key, { key, emb, proc, width, height, bytes, lastUsed: ++clock });
  evictIfNeeded();
  console.log(`[samRacket] encoded ${key} in ${ms.toFixed(0)}ms (${(bytes / 1e6).toFixed(1)}MB embedding)`);
  return { ms, bytes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CANDIDATE PLAUSIBILITY — do NOT pick by argmax.
 *
 * SAM returns three candidates with IoU scores, and the probe measured the
 * decisive failure directly: a click one racket-width off the racket returned
 * the WHOLE CLAY COURT at score 0.944, the HIGHEST of the three, while the
 * small correct-scale masks scored 0.026 and 0.334. SAM's score answers "is
 * this a clean mask of SOMETHING", not "is this a racket".
 *
 * So candidates are gated on being racket-SHAPED before score is consulted:
 * small enough not to be the person or the court, big enough not to be a speck,
 * and actually covering the point the coach just clicked. Score only ranks the
 * survivors. When nothing survives we return the least-bad survivor-by-area
 * rather than the top score — and if even that fails, null. No racket beats a
 * wrong racket.
 */
function pickCandidate(cands: SamCandidate[]): number {
  const ok = cands
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.vetoed);
  if (ok.length) {
    ok.sort((a, b) => b.c.score - a.c.score);
    return ok[0].i;
  }
  // Everything was vetoed. Prefer one that at least covers the click and is not
  // the whole frame — a fragment the brush can finish beats nothing to edit.
  const fallback = cands
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.coversClick && c.areaPct <= MAX_PLAUSIBLE_AREA_PCT)
    .sort((a, b) => b.c.score - a.c.score);
  return fallback.length ? fallback[0].i : -1;
}

/**
 * Run the decoder for a frame with the FULL accumulated point list.
 *
 * ACCUMULATION IS THE POINT. Every call passes every point the coach has placed
 * so far, so the mask GROWS to cover more of the racket with each click rather
 * than being re-segmented from scratch. That is the fix for the behaviour Vin
 * saw, where a second click replaced the first result instead of extending it.
 * Negative points (label 0) subtract wrongly-grabbed court or body in the same
 * single decode.
 */
export async function decodeRacketMask(
  key: string,
  points: SamPoint[],
  /** Force a specific candidate (the coach overriding the plausibility pick). */
  forceCandidate?: number,
): Promise<SamDecodeResult | null> {
  const session = await getSession();
  const enc = encodedFrames.get(key);
  if (!session || !enc) return null;
  if (!points.some((p) => p.label === 1)) return null; // nothing to segment yet

  enc.lastUsed = ++clock;
  const { model, processor } = session;

  const inputPoints = processor.reshape_input_points(
    [[points.map((p) => [p.x, p.y])]],
    enc.proc.original_sizes,
    enc.proc.reshaped_input_sizes,
  );
  const inputLabels = processor.image_processor.add_input_labels(
    [[points.map((p) => p.label)]],
    inputPoints,
  );

  const t0 = performance.now();
  const out = await model({ ...enc.emb, input_points: inputPoints, input_labels: inputLabels });
  const decodeMs = performance.now() - t0;

  // binarize:false keeps the raw logits, which is what the soft alpha needs.
  const upscaled = await processor.post_process_masks(
    out.pred_masks,
    enc.proc.original_sizes,
    enc.proc.reshaped_input_sizes,
    { binarize: false },
  );
  const t = upscaled[0];
  const [, nCand, mh, mw] = t.dims as number[];
  const all = t.data as Float32Array;
  const per = mh * mw;

  const scores = Array.from(out.iou_scores.data as Float32Array).slice(0, nCand);
  const newest = [...points].reverse().find((p) => p.label === 1)!;

  const candidates: SamCandidate[] = [];
  for (let c = 0; c < nCand; c++) {
    const off = c * per;
    let on = 0;
    for (let p = 0; p < per; p++) if (all[off + p] > 0) on++;
    const areaPct = (on / per) * 100;

    // Does the mask reach the newest positive click? Checked over a small disc
    // so a one-pixel miss on a thin racket frame does not veto a good mask.
    let coversClick = false;
    const cx = Math.round(newest.x);
    const cy = Math.round(newest.y);
    for (let dy = -CLICK_TOLERANCE_PX; dy <= CLICK_TOLERANCE_PX && !coversClick; dy++) {
      for (let dx = -CLICK_TOLERANCE_PX; dx <= CLICK_TOLERANCE_PX; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= mw || y >= mh) continue;
        if (all[off + y * mw + x] > 0) {
          coversClick = true;
          break;
        }
      }
    }

    let vetoed: string | null = null;
    if (areaPct > MAX_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(1)}% — person/court`;
    else if (areaPct < MIN_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(4)}% — speck`;
    else if (!coversClick) vetoed = 'does not cover the click';

    candidates.push({ score: scores[c], areaPct, coversClick, vetoed });
  }

  const chosen =
    forceCandidate != null && forceCandidate >= 0 && forceCandidate < nCand
      ? forceCandidate
      : pickCandidate(candidates);

  console.log(
    `[samRacket] ${key}: decode ${decodeMs.toFixed(0)}ms, ${points.length} pts ` +
      `(${points.filter((p) => p.label === 1).length}+/${points.filter((p) => p.label === 0).length}-) → ` +
      candidates
        .map((c, i) => `#${i} s=${c.score.toFixed(3)} a=${c.areaPct.toFixed(2)}%${c.vetoed ? ` VETO(${c.vetoed})` : ''}`)
        .join('  ') +
      ` → picked ${chosen < 0 ? 'NONE' : `#${chosen}`}`,
  );

  if (chosen < 0) return null;

  // Logits → soft alpha. Ramp starts AT the decision boundary so nothing below
  // it paints; a wider ramp would bleed background in at low alpha.
  const data = new Uint8ClampedArray(per);
  const off = chosen * per;
  for (let p = 0; p < per; p++) {
    const s = Math.max(0, Math.min(1, all[off + p] / LOGIT_SOFT_WIDTH));
    data[p] = Math.round(s * s * (3 - 2 * s) * 255);
  }

  return {
    mask: { width: mw, height: mh, data },
    chosen,
    candidates,
    decodeMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX-PROMPTED DECODE — the auto-detected racket, same session, same cache.
//
// WHY A SECOND DECODE FUNCTION RATHER THAN A PARAMETER ON THE FIRST.
// `decodeRacketMask` is the CLICK path: it accumulates the coach's points and
// gates candidates on covering the newest click. Neither idea exists for an
// auto-detected box — there is no click to cover and nothing to accumulate — so
// threading a mode flag through it would mean two behaviours sharing one body,
// with the shipped, measured interactive path carrying the risk of every future
// edit to the automatic one. The tensor plumbing is duplicated instead. The
// SESSION, the EMBEDDING CACHE and the LRU are not: a frame encoded for one path
// decodes for free on the other, which is the whole point.
// ─────────────────────────────────────────────────────────────────────────────

/** A box prompt in FULL-FRAME VIDEO PIXELS (x1,y1 = top-left, x2,y2 = bottom-right). */
export interface SamPromptBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * How much of a candidate mask must fall INSIDE the prompt box.
 *
 * The box-prompt equivalent of `coversClick`. SAM treats a box as a strong hint,
 * not a hard boundary, so a candidate is free to wander off into the court behind
 * the racket; one that is mostly outside the box the detector drew is not the
 * thing that was detected. Not 1.0 because a genuine racket mask legitimately
 * spills a little past a tight detector box, especially on a motion-blurred edge.
 */
const MIN_IN_BOX_FRACTION = 0.5;

/**
 * Segment the racket from an AUTO-DETECTED BOX rather than from clicks.
 *
 * The frame must already be encoded (`encodeFrameForRacket`). Returns null when
 * the model is unavailable, the frame is not encoded, or nothing plausible came
 * back — the caller then leaves the mask alone and the coach's click path is
 * still there. Fail-closed, exactly like the click path: no racket beats a wrong
 * racket, and a wrong box would come back as a confident, cleanly-segmented piece
 * of the court that then unions into every frame of the composite.
 */
export async function decodeRacketMaskFromBox(
  key: string,
  box: SamPromptBox,
): Promise<SamDecodeResult | null> {
  const session = await getSession();
  const enc = encodedFrames.get(key);
  if (!session || !enc) return null;
  if (!(box.x2 > box.x1 && box.y2 > box.y1)) return null;

  enc.lastUsed = ++clock;
  const { model, processor } = session;

  // is_bounding_box = true — the 4th argument keeps the [batch, nBoxes, 4] shape
  // instead of the [batch, pointBatch, nPoints, 2] the point path wants.
  const inputBoxes = processor.reshape_input_points(
    [[[box.x1, box.y1, box.x2, box.y2]]],
    enc.proc.original_sizes,
    enc.proc.reshaped_input_sizes,
    true,
  );

  const t0 = performance.now();
  const out = await model({ ...enc.emb, input_boxes: inputBoxes });
  const decodeMs = performance.now() - t0;

  const upscaled = await processor.post_process_masks(
    out.pred_masks,
    enc.proc.original_sizes,
    enc.proc.reshaped_input_sizes,
    { binarize: false },
  );
  const t = upscaled[0];
  const [, nCand, mh, mw] = t.dims as number[];
  const all = t.data as Float32Array;
  const per = mh * mw;

  const scores = Array.from(out.iou_scores.data as Float32Array).slice(0, nCand);
  const bx0 = Math.max(0, Math.floor(box.x1));
  const by0 = Math.max(0, Math.floor(box.y1));
  const bx1 = Math.min(mw, Math.ceil(box.x2));
  const by1 = Math.min(mh, Math.ceil(box.y2));

  const candidates: SamCandidate[] = [];
  for (let c = 0; c < nCand; c++) {
    const off = c * per;
    let on = 0;
    let inBox = 0;
    for (let y = 0; y < mh; y++) {
      const row = off + y * mw;
      const yIn = y >= by0 && y < by1;
      for (let x = 0; x < mw; x++) {
        if (all[row + x] > 0) {
          on++;
          if (yIn && x >= bx0 && x < bx1) inBox++;
        }
      }
    }
    const areaPct = (on / per) * 100;
    const inBoxFrac = on ? inBox / on : 0;

    let vetoed: string | null = null;
    if (areaPct > MAX_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(1)}% — person/court`;
    else if (areaPct < MIN_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(4)}% — speck`;
    else if (inBoxFrac < MIN_IN_BOX_FRACTION) vetoed = `${(inBoxFrac * 100).toFixed(0)}% inside the box`;

    // `coversClick` carries the in-box fraction here — same field, and there is
    // no click on this path for it to mean anything else.
    candidates.push({ score: scores[c], areaPct, coversClick: inBoxFrac >= MIN_IN_BOX_FRACTION, vetoed });
  }

  const ok = candidates.map((c, i) => ({ c, i })).filter(({ c }) => !c.vetoed);
  ok.sort((a, b) => b.c.score - a.c.score);
  const chosen = ok.length ? ok[0].i : -1;

  console.log(
    `[autoRacket] ${key}: SAM box-decode ${decodeMs.toFixed(0)}ms → ` +
      candidates
        .map((c, i) => `#${i} s=${c.score.toFixed(3)} a=${c.areaPct.toFixed(2)}%${c.vetoed ? ` VETO(${c.vetoed})` : ''}`)
        .join('  ') +
      ` → picked ${chosen < 0 ? 'NONE' : `#${chosen}`}`,
  );

  if (chosen < 0) return null;

  // Same logit → alpha ramp as the click path, so an auto racket and a clicked
  // one share one alpha convention and can union without a seam.
  const data = new Uint8ClampedArray(per);
  const off = chosen * per;
  for (let p = 0; p < per; p++) {
    const s = Math.max(0, Math.min(1, all[off + p] / LOGIT_SOFT_WIDTH));
    data[p] = Math.round(s * s * (3 - 2 * s) * 255);
  }

  return { mask: { width: mw, height: mh, data }, chosen, candidates, decodeMs };
}

/**
 * Union a racket mask into a Motion Layer mask.
 *
 * max(), matching the bone-core union and the 2c contract: where the segmenter
 * already found something, its own better-fitting alpha wins; the racket only
 * fills what was missing. STRICTLY ADDITIVE — this can never lower a person-
 * cutout pixel, so applying a racket cannot damage the cutout. Soft alpha is
 * preserved on both sides.
 */
export function unionRacketIntoMask(base: AlphaMask, racket: AlphaMask): AlphaMask {
  const out: AlphaMask = {
    width: base.width,
    height: base.height,
    data: new Uint8ClampedArray(base.data),
  };
  if (racket.width !== base.width || racket.height !== base.height) {
    console.warn('[samRacket] union skipped — size mismatch', base.width, base.height, racket.width, racket.height);
    return out;
  }
  for (let i = 0; i < out.data.length; i++) {
    if (racket.data[i] > out.data[i]) out.data[i] = racket.data[i];
  }
  return out;
}
