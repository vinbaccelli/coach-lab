/**
 * MobileSAM backend for the mask editor's Object tool and the racket box prompt. The DEFAULT in the racket worker (phones);
 * racketWorker.ts falls back to SAM-2 if this module cannot load or run.
 *
 * Same exported functions as samRacket.ts (encodeFrameForRacket, decodeRacketMask, decodeRacketMaskFromBox, ...). Why: SAM-2 holds
 * ~850 MB on a phone and the page is killed by memory; MobileSAM's image encoder is a 28 MB TinyViT (desktop: ~390 MB peak with a
 * limited arena, IoU 0.95 against the PyTorch original).
 *
 * Model files: /models/mobilesam/encoder-v1.onnx and decoder-v1.onnx (public assets, same-origin, 1-year immutable cache; a new
 * version gets a new file name). Converted by us from the official Apache-2.0 checkpoint: docs/MOBILESAM_PROVENANCE.md.
 *
 * Uses onnxruntime-web (already installed as a dependency of transformers.js) on the wasm EP with the phone memory options.
 */
import { frameToCanvas, type FrameSource } from '@/lib/stroMotionDraft/frameCanvas';
import { mobileSamTarget, rgbaToMobileSamInput, scalePoint } from '@/lib/stroMotionDraft/samMobilePre';
import { isPhoneBudgetActive, PHONE_ORT_SESSION_OPTIONS } from '@/lib/stroMotionDraft/phoneBudget';
import type { SamCandidate, SamDecodeResult, SamPoint, SamPromptBox } from '@/lib/stroMotionDraft/samRacket';

export const MOBILE_SAM_ENCODER_URL = '/models/mobilesam/encoder-v1.onnx';
export const MOBILE_SAM_DECODER_URL = '/models/mobilesam/decoder-v1.onnx';

const MAX_PLAUSIBLE_AREA_PCT = 12;
const MIN_PLAUSIBLE_AREA_PCT = 0.002;
const CLICK_TOLERANCE_PX = 6;
const LOGIT_SOFT_WIDTH = 2;
const MIN_IN_BOX_FRACTION = 0.5;
/** Embeddings are 4 MB each (256x64x64 float32): a small cache is enough and cheap. */
const CACHE_MAX_FRAMES = 6;

type Ort = typeof import('onnxruntime-web');
interface Session { ort: Ort; encoder: import('onnxruntime-web').InferenceSession; decoder: import('onnxruntime-web').InferenceSession }
interface Encoded { key: string; emb: Float32Array; scale: number; width: number; height: number; bytes: number; lastUsed: number }

let sessionPromise: Promise<Session | null> | null = null;
const frames = new Map<string, Encoded>();
let clock = 0;
let lastSamError = '';
export function getLastSamError(): string { return lastSamError; }

async function getSession(): Promise<Session | null> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      const ort = (await import('onnxruntime-web/wasm')) as Ort;
      ort.env.wasm.wasmPaths = '/ort/';
      if (isPhoneBudgetActive()) ort.env.wasm.numThreads = 1;
      const opts = { executionProviders: ['wasm'], ...(isPhoneBudgetActive() ? PHONE_ORT_SESSION_OPTIONS : {}) } as import('onnxruntime-web').InferenceSession.SessionOptions;
      const encoder = await ort.InferenceSession.create(MOBILE_SAM_ENCODER_URL, opts);
      const decoder = await ort.InferenceSession.create(MOBILE_SAM_DECODER_URL, opts);
      console.log('[samMobile] MobileSAM ready (wasm, /models/mobilesam)');
      return { ort, encoder, decoder };
    } catch (e) {
      console.warn('[samMobile] model load failed:', e);
      lastSamError = `model load failed: ${e instanceof Error ? e.message : String(e)}`;
      sessionPromise = null;
      return null;
    }
  })();
  return sessionPromise;
}

export function isFrameEncoded(key: string): boolean { return frames.has(key); }
export function racketCacheStats(): { frames: number; bytes: number } {
  let bytes = 0; frames.forEach((e) => (bytes += e.bytes)); return { frames: frames.size, bytes };
}
export function clearRacketEncodings(): void { frames.clear(); }
export function dropRacketEncoding(key: string): void { frames.delete(key); }
export async function releaseSamRacket(): Promise<void> {
  frames.clear();
  const dead = sessionPromise; sessionPromise = null;
  try { const s = await dead; await s?.encoder.release(); await s?.decoder.release(); } catch { /* being dropped anyway */ }
}

function evict(): void {
  while (frames.size > CACHE_MAX_FRAMES) {
    let oldest: Encoded | null = null;
    frames.forEach((e) => { if (!oldest || e.lastUsed < oldest.lastUsed) oldest = e; });
    if (!oldest) break;
    frames.delete((oldest as Encoded).key);
  }
}

export async function encodeFrameForRacket(key: string, frame: FrameSource): Promise<{ ms: number; bytes: number } | null> {
  const session = await getSession();
  if (!session) return null;
  const existing = frames.get(key);
  if (existing) { existing.lastUsed = ++clock; return { ms: 0, bytes: existing.bytes }; }

  const src = frameToCanvas(frame);
  const width = frame.width; const height = frame.height;
  const t = mobileSamTarget(width, height);
  const small: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(t.width, t.height) : Object.assign(document.createElement('canvas'), { width: t.width, height: t.height });
  const sctx = small.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src as CanvasImageSource, 0, 0, t.width, t.height);
  const rgba = sctx.getImageData(0, 0, t.width, t.height).data;

  const t0 = performance.now();
  try {
    const input = new session.ort.Tensor('float32', rgbaToMobileSamInput(rgba, t.width, t.height), [1, 3, 1024, 1024]);
    const out = await session.encoder.run({ images: input });
    const emb = (out.image_embeddings.data as Float32Array).slice(); // own copy: the session's output buffer is reused
    try { out.image_embeddings.dispose(); } catch { /* ignore */ }
    const enc: Encoded = { key, emb, scale: t.scale, width, height, bytes: emb.byteLength, lastUsed: ++clock };
    frames.set(key, enc); evict();
    const ms = performance.now() - t0;
    console.log(`[samMobile] encoded ${key} in ${ms.toFixed(0)}ms (${(enc.bytes / 1e6).toFixed(1)}MB embedding)`);
    return { ms, bytes: enc.bytes };
  } catch (e) {
    console.warn('[samMobile] encode failed:', e);
    lastSamError = `encode failed: ${e instanceof Error ? e.message : String(e)}`;
    return null;
  }
}

/** Run the decoder with prompt coordinates already in 1024-space. Returns the logit field (full frame) and the model's score. */
async function runDecoder(session: Session, enc: Encoded, coords: number[], labels: number[]): Promise<{ logits: Float32Array; score: number; ms: number }> {
  const { Tensor } = session.ort;
  const n = labels.length;
  const t0 = performance.now();
  const out = await session.decoder.run({
    image_embeddings: new Tensor('float32', enc.emb, [1, 256, 64, 64]),
    point_coords: new Tensor('float32', Float32Array.from(coords), [1, n, 2]),
    point_labels: new Tensor('float32', Float32Array.from(labels), [1, n]),
    mask_input: new Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new Tensor('float32', Float32Array.from([0]), [1]),
    orig_im_size: new Tensor('float32', Float32Array.from([enc.height, enc.width]), [2]),
  });
  const logits = (out.masks.data as Float32Array).slice(0, enc.width * enc.height);
  const score = (out.iou_predictions.data as Float32Array)[0];
  return { logits, score, ms: performance.now() - t0 };
}

function toAlpha(logits: Float32Array): Uint8ClampedArray {
  const data = new Uint8ClampedArray(logits.length);
  for (let p = 0; p < logits.length; p++) {
    const s = Math.max(0, Math.min(1, logits[p] / LOGIT_SOFT_WIDTH));
    data[p] = Math.round(s * s * (3 - 2 * s) * 255);
  }
  return data;
}

export async function decodeRacketMask(key: string, points: SamPoint[], forceCandidate?: number): Promise<SamDecodeResult | null> {
  void forceCandidate; // MobileSAM returns the single best mask: there is no candidate to force
  const session = await getSession();
  const enc = frames.get(key);
  if (!session || !enc) return null;
  if (!points.some((p) => p.label === 1)) return null;
  enc.lastUsed = ++clock;

  const coords: number[] = []; const labels: number[] = [];
  for (const p of points) { const [x, y] = scalePoint(p, enc.scale); coords.push(x, y); labels.push(p.label); }
  coords.push(0, 0); labels.push(-1); // the decoder's padding point, as in segment-anything's ONNX example
  const { logits, score, ms } = await runDecoder(session, enc, coords, labels);

  const per = enc.width * enc.height;
  let on = 0; for (let p = 0; p < per; p++) if (logits[p] > 0) on++;
  const areaPct = (on / per) * 100;
  const newest = [...points].reverse().find((p) => p.label === 1)!;
  let coversClick = false;
  const cx = Math.round(newest.x); const cy = Math.round(newest.y);
  for (let dy = -CLICK_TOLERANCE_PX; dy <= CLICK_TOLERANCE_PX && !coversClick; dy++) {
    for (let dx = -CLICK_TOLERANCE_PX; dx <= CLICK_TOLERANCE_PX; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= enc.width || y >= enc.height) continue;
      if (logits[y * enc.width + x] > 0) { coversClick = true; break; }
    }
  }
  let vetoed: string | null = null;
  if (areaPct > MAX_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(1)}% — person/court`;
  else if (areaPct < MIN_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(4)}% — speck`;
  else if (!coversClick) vetoed = 'does not cover the click';
  const cand: SamCandidate = { score, areaPct, coversClick, vetoed };
  console.log(`[samMobile] ${key}: decode ${ms.toFixed(0)}ms, ${points.length} pts → s=${score.toFixed(3)} a=${areaPct.toFixed(2)}%${vetoed ? ` VETO(${vetoed})` : ''}`);
  // Same acceptance rule as samRacket.pickCandidate: a mask that covers the click and is not person/court sized.
  if (!coversClick || areaPct > MAX_PLAUSIBLE_AREA_PCT) return null;
  return { mask: { width: enc.width, height: enc.height, data: toAlpha(logits) }, chosen: 0, candidates: [cand], decodeMs: ms };
}

export async function decodeRacketMaskFromBox(key: string, box: SamPromptBox): Promise<SamDecodeResult | null> {
  const session = await getSession();
  const enc = frames.get(key);
  if (!session || !enc) return null;
  if (!(box.x2 > box.x1 && box.y2 > box.y1)) return null;
  enc.lastUsed = ++clock;
  const [x1, y1] = scalePoint({ x: box.x1, y: box.y1 }, enc.scale);
  const [x2, y2] = scalePoint({ x: box.x2, y: box.y2 }, enc.scale);
  const { logits, score, ms } = await runDecoder(session, enc, [x1, y1, x2, y2], [2, 3]); // 2/3 = box corners

  const per = enc.width * enc.height;
  let on = 0; let inBox = 0;
  for (let y = 0; y < enc.height; y++) {
    for (let x = 0; x < enc.width; x++) {
      if (logits[y * enc.width + x] > 0) { on++; if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) inBox++; }
    }
  }
  const areaPct = (on / per) * 100;
  let vetoed: string | null = null;
  if (areaPct > MAX_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(1)}% — person/court`;
  else if (areaPct < MIN_PLAUSIBLE_AREA_PCT) vetoed = `area ${areaPct.toFixed(4)}% — speck`;
  else if (on > 0 && inBox / on < MIN_IN_BOX_FRACTION) vetoed = 'mostly outside the detected box';
  const cand: SamCandidate = { score, areaPct, coversClick: true, vetoed };
  console.log(`[samMobile] ${key}: box decode ${ms.toFixed(0)}ms → s=${score.toFixed(3)} a=${areaPct.toFixed(2)}%${vetoed ? ` VETO(${vetoed})` : ''}`);
  if (vetoed) return null;
  return { mask: { width: enc.width, height: enc.height, data: toAlpha(logits) }, chosen: 0, candidates: [cand], decodeMs: ms };
}
