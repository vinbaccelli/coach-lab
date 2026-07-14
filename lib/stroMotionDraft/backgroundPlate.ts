'use client';

/**
 * Temporal-median background plate — the foundation of Dartfish-style motion
 * masking. Sample N frames spread across the section and take the per-pixel,
 * per-channel MEDIAN: anything that moves (player, racket, ball) appears in a
 * minority of samples and vanishes, leaving clean background even where the
 * object sits in SOME frames. Diffing a frame against this plate isolates the
 * moving object far more robustly than diffing against any single frame.
 *
 * Built at capped resolution (mask work doesn't need full res) and cached by
 * the caller per section.
 */

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureFrame';

export interface BackgroundPlate {
  bitmap: ImageBitmap;
  /** Plate pixels per video pixel (≤ 1). */
  scale: number;
  width: number;
  height: number;
}

const PLATE_MAX_W = 640;
const PLATE_SAMPLES = 11;

export async function buildMedianBackgroundPlate(
  video: HTMLVideoElement,
  startSec: number,
  endSec: number,
  onProgress?: (done: number, total: number) => void,
): Promise<BackgroundPlate | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 16 || vh < 16) return null;
  const span = Math.max(0.05, endSec - startSec);

  const scale = Math.min(1, PLATE_MAX_W / vw);
  const w = Math.max(8, Math.round(vw * scale));
  const h = Math.max(8, Math.round(vh * scale));

  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Collect N downscaled frames spread across the section.
  const layers: Uint8ClampedArray[] = [];
  for (let i = 0; i < PLATE_SAMPLES; i++) {
    const t = startSec + (span * (i + 0.5)) / PLATE_SAMPLES;
    try {
      const bmp = await captureVideoFrameAtTime(video, t);
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      layers.push(new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data));
    } catch {
      /* skip unreadable frame */
    }
    onProgress?.(i + 1, PLATE_SAMPLES);
  }
  if (layers.length < 5) return null;

  // Per-pixel per-channel median.
  const out = ctx.createImageData(w, h);
  const n = layers.length;
  const vals = new Uint8ClampedArray(n);
  const mid = n >> 1;
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) {
      const o = p * 4 + c;
      for (let l = 0; l < n; l++) vals[l] = layers[l][o];
      // Small n — insertion sort beats Array#sort here.
      for (let a = 1; a < n; a++) {
        const v = vals[a];
        let b = a - 1;
        while (b >= 0 && vals[b] > v) { vals[b + 1] = vals[b]; b--; }
        vals[b + 1] = v;
      }
      out.data[o] = n % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) >> 1;
    }
    out.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const bitmap = await createImageBitmap(cnv);
  return { bitmap, scale, width: w, height: h };
}
