'use client';

/**
 * Lightweight tennis-racket localization using TensorFlow.js COCO-SSD (MobileNetV2).
 * Runs in the browser; first call downloads model weights (~20MB).
 */

export type NormRect = { x: number; y: number; w: number; h: number };

// Elongated sports implements COCO-SSD can localize. (COCO has no golf-club
// class — golf swings fall back to the wrist-extension estimate.)
const IMPLEMENT_CLASSES = new Set(['tennis racket', 'baseball bat']);

let modelPromise: Promise<import('@tensorflow-models/coco-ssd').ObjectDetection> | null = null;

export function preloadRacketDetector(): void {
  if (typeof window === 'undefined') return;
  void getRacketDetectorModel();
}

async function getRacketDetectorModel(): Promise<import('@tensorflow-models/coco-ssd').ObjectDetection> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return cocoSsd.load({ base: 'mobilenet_v2' });
    })();
  }
  return modelPromise;
}

/**
 * Returns a bounding box in **video-normalized** 0..1 coordinates, or null if not found.
 */
export async function detectTennisRacketNorm(
  video: HTMLVideoElement,
  options?: { maxDetections?: number; minScore?: number; pad?: number },
): Promise<NormRect | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 16 || vh < 16 || video.readyState < 2) return null;

  const maxDetections = options?.maxDetections ?? 12;
  const minScore = options?.minScore ?? 0.32;
  const pad = options?.pad ?? 0.08;

  const model = await getRacketDetectorModel();
  const preds = await model.detect(video, maxDetections, minScore);
  const racket = preds.find((p) => IMPLEMENT_CLASSES.has(p.class));
  if (!racket) return null;

  let [bx, by, bw, bh] = racket.bbox;
  bw = Math.max(4, bw);
  bh = Math.max(4, bh);
  bx -= bw * pad * 0.5;
  by -= bh * pad * 0.5;
  bw *= 1 + pad;
  bh *= 1 + pad;

  const nx = Math.max(0, Math.min(1, bx / vw));
  const ny = Math.max(0, Math.min(1, by / vh));
  const nwRaw = bw / vw;
  const nhRaw = bh / vh;
  const nw = Math.max(0.02, Math.min(1 - nx, nwRaw));
  const nh = Math.max(0.02, Math.min(1 - ny, nhRaw));

  return { x: nx, y: ny, w: nw, h: nh };
}

function rectCenter(r: NormRect): { cx: number; cy: number } {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}

function expandNormRect(r: NormRect, ratio: number): NormRect {
  const padW = r.w * ratio;
  const padH = r.h * ratio;
  const x = Math.max(0, r.x - padW);
  const y = Math.max(0, r.y - padH);
  const w = Math.min(1 - x, r.w + padW * 2);
  const h = Math.min(1 - y, r.h + padH * 2);
  return { x, y, w, h };
}

function pointInRect(px: number, py: number, r: NormRect): boolean {
  return px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
}

/**
 * Detect tennis racket near a coach hint — searches expanded region, picks best match.
 */
export async function detectTennisRacketNearHint(
  video: HTMLVideoElement,
  hint: NormRect,
  options?: { maxDetections?: number; minScore?: number; pad?: number; searchExpand?: number },
): Promise<{ box: NormRect; score: number } | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 16 || vh < 16 || video.readyState < 2) return null;

  const maxDetections = options?.maxDetections ?? 20;
  const minScore = options?.minScore ?? 0.22;
  const pad = options?.pad ?? 0.08;
  const searchExpand = options?.searchExpand ?? 0.75;
  const search = expandNormRect(hint, searchExpand);
  const hintCenter = rectCenter(hint);

  const model = await getRacketDetectorModel();
  const preds = await model.detect(video, maxDetections, minScore);
  const rackets = preds.filter((p) => IMPLEMENT_CLASSES.has(p.class));

  let best: { box: NormRect; score: number; dist: number } | null = null;

  for (const racket of rackets) {
    let [bx, by, bw, bh] = racket.bbox;
    bw = Math.max(4, bw);
    bh = Math.max(4, bh);
    const nx = Math.max(0, Math.min(1, bx / vw));
    const ny = Math.max(0, Math.min(1, by / vh));
    const nw = Math.max(0.02, Math.min(1 - nx, bw / vw));
    const nh = Math.max(0.02, Math.min(1 - ny, bh / vh));
    const center = rectCenter({ x: nx, y: ny, w: nw, h: nh });
    if (!pointInRect(center.cx, center.cy, search)) continue;

    const dist = Math.hypot(center.cx - hintCenter.cx, center.cy - hintCenter.cy);
    const score = racket.score ?? 0;
    if (!best || score > best.score || (score === best.score && dist < best.dist)) {
      best = { box: { x: nx, y: ny, w: nw, h: nh }, score, dist };
    }
  }

  if (!best) return null;

  let { x: bx, y: by, w: bw, h: bh } = best.box;
  bx -= bw * pad * 0.5;
  by -= bh * pad * 0.5;
  bw *= 1 + pad;
  bh *= 1 + pad;
  const nx = Math.max(0, Math.min(1, bx));
  const ny = Math.max(0, Math.min(1, by));
  const nw = Math.max(0.02, Math.min(1 - nx, bw));
  const nh = Math.max(0.02, Math.min(1 - ny, bh));

  return { box: { x: nx, y: ny, w: nw, h: nh }, score: best.score };
}
