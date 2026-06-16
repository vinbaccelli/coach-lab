'use client';

import type { AlphaMask } from '@/lib/stroMotionDraft/types';

export interface MultiplierFrame {
  imageData: ImageBitmap;
  timestamp: number;
  region: { x: number; y: number; w: number; h: number };
}

const FPS = 10;
const FRAME_DT = 1 / FPS;

function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Robust background colour from full border band (median RGB). */
function estimateBorderBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 28));
  const band = Math.max(2, Math.floor(Math.min(w, h) * 0.06));

  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };

  for (let x = 0; x < w; x += step) {
    for (let y = 0; y < band; y++) sample(x, y);
    for (let y = h - band; y < h; y++) sample(x, y);
  }
  for (let y = band; y < h - band; y += step) {
    for (let x = 0; x < band; x++) sample(x, y);
    for (let x = w - band; x < w; x++) sample(x, y);
  }

  return [median(rs), median(gs), median(bs)];
}

/**
 * Border-connected flood fill — removes court/wall background while keeping the object.
 * Feathered alpha reduces halos around racket edges.
 */
function matteFromBorderFlood(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  br: number,
  bg: number,
  bb: number,
): Uint8ClampedArray {
  const n = w * h;
  const isBg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const distAt = (idx: number) => {
    const i = idx * 4;
    return colorDist(data[i], data[i + 1], data[i + 2], br, bg, bb);
  };

  const T_SEED = 20;
  const T_FLOOD = 36;

  const trySeed = (idx: number) => {
    if (isBg[idx]) return;
    if (distAt(idx) > T_SEED) return;
    isBg[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < w; x++) {
    trySeed(x);
    trySeed((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    trySeed(y * w);
    trySeed(y * w + w - 1);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;

    if (x > 0) {
      const nIdx = idx - 1;
      if (!isBg[nIdx] && distAt(nIdx) <= T_FLOOD) {
        isBg[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (x < w - 1) {
      const nIdx = idx + 1;
      if (!isBg[nIdx] && distAt(nIdx) <= T_FLOOD) {
        isBg[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (y > 0) {
      const nIdx = idx - w;
      if (!isBg[nIdx] && distAt(nIdx) <= T_FLOOD) {
        isBg[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (y < h - 1) {
      const nIdx = idx + w;
      if (!isBg[nIdx] && distAt(nIdx) <= T_FLOOD) {
        isBg[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  // Fill small holes inside the object (speckles from similar-to-bg pixels).
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (!isBg[idx]) continue;
      let fgNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!isBg[(y + dy) * w + (x + dx)]) fgNeighbors++;
        }
      }
      if (fgNeighbors >= 6) isBg[idx] = 0;
    }
  }

  const alpha = new Uint8Array(n);
  for (let idx = 0; idx < n; idx++) {
    alpha[idx] = isBg[idx] ? 0 : 255;
  }

  // Feather foreground pixels adjacent to background for softer edges.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (alpha[idx] === 0) continue;
      let bgNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (alpha[(y + dy) * w + (x + dx)] === 0) bgNeighbors++;
        }
      }
      if (bgNeighbors > 0) {
        const d = distAt(idx);
        const edge = Math.min(1, Math.max(0, (d - T_SEED) / (T_FLOOD - T_SEED + 1)));
        const neighborFactor = 1 - bgNeighbors / 8;
        alpha[idx] = Math.round(255 * Math.max(0.35, edge * 0.65 + neighborFactor * 0.35));
      }
    }
  }

  const out = new Uint8ClampedArray(data.length);
  for (let idx = 0; idx < n; idx++) {
    const i = idx * 4;
    out[i] = data[i];
    out[i + 1] = data[i + 1];
    out[i + 2] = data[i + 2];
    out[i + 3] = alpha[idx];
  }
  return out;
}

/** Full-frame border flood matte as an alpha mask (StroMotion mask editor). */
export async function buildMatteAlphaMask(bitmap: ImageBitmap): Promise<AlphaMask> {
  const w = bitmap.width;
  const h = bitmap.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h) };
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  const [br, bg, bb] = estimateBorderBackground(data, w, h);
  const matted = matteFromBorderFlood(data, w, h, br, bg, bb);
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = matted[i * 4 + 3];
  }
  return { width: w, height: h, data: alpha };
}

/**
 * Background suppression from border-connected flood fill — yields a cutout
 * without blocking the UI (async yield between heavy frames).
 */
export async function matteRacketFrame(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const w = bitmap.width;
  const h = bitmap.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    const copy = await createImageBitmap(bitmap);
    return copy;
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  const [br, bg, bb] = estimateBorderBackground(data, w, h);
  const matted = matteFromBorderFlood(data, w, h, br, bg, bb);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(matted), w, h), 0, 0);
  const result = await createImageBitmap(c);
  bitmap.close();
  return result;
}

export class ObjectMultiplier {
  private frames: MultiplierFrame[] = [];

  async captureFrame(
    video: HTMLVideoElement,
    region: { x: number; y: number; w: number; h: number },
    matte = true,
  ): Promise<MultiplierFrame> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.round(region.x * vw);
    const sy = Math.round(region.y * vh);
    const sw = Math.round(region.w * vw);
    const sh = Math.round(region.h * vh);

    let bitmap = await createImageBitmap(video, sx, sy, sw, sh);
    if (matte) {
      bitmap = await matteRacketFrame(bitmap);
    }
    const frame: MultiplierFrame = {
      imageData: bitmap,
      timestamp: video.currentTime,
      region,
    };
    this.frames.push(frame);
    return frame;
  }

  /**
   * Samples `frameCount` frames at exactly `FPS` (10fps) forward from the current video time.
   */
  async autoCaptureSequence(
    video: HTMLVideoElement,
    region: { x: number; y: number; w: number; h: number },
    frameCount: number,
    _spanSecondsUnused: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<MultiplierFrame[]> {
    const choices = [3, 5, 8, 10] as const;
    const clampedCount = choices.includes(frameCount as 3 | 5 | 8 | 10)
      ? (frameCount as 3 | 5 | 8 | 10)
      : 5;

    const wasPaused = video.paused;
    const startTime = video.currentTime;
    const span = (clampedCount - 1) * FRAME_DT;
    const endBoundary = startTime + span;
    const endTime =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(video.duration, endBoundary)
        : endBoundary;

    if (!wasPaused) video.pause();

    const captured: MultiplierFrame[] = [];

    for (let i = 0; i < clampedCount; i++) {
      const targetTime = Math.min(endTime, startTime + i * FRAME_DT);
      video.currentTime = targetTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });

      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const frame = await this.captureFrame(video, region, true);
      captured.push(frame);
      onProgress?.(i + 1, clampedCount);
    }

    video.currentTime = startTime;
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });

    if (!wasPaused) {
      void video.play().catch(() => {});
    }

    return captured;
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    opacity = 0.52,
  ): void {
    if (this.frames.length === 0) return;

    ctx.save();
    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i];
      const alpha =
        this.frames.length === 1
          ? opacity
          : ((i + 1) / this.frames.length) * opacity;
      ctx.globalAlpha = Math.max(0.08, alpha);

      const dx = frame.region.x * canvasW + i * 1.5;
      const dy = frame.region.y * canvasH - i * 0.8;
      const dw = frame.region.w * canvasW;
      const dh = frame.region.h * canvasH;
      ctx.drawImage(frame.imageData, dx, dy, dw, dh);
    }

    if (this.frames.length > 0) {
      const last = this.frames[this.frames.length - 1];
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#9333EA';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        last.region.x * canvasW,
        last.region.y * canvasH,
        last.region.w * canvasW,
        last.region.h * canvasH,
      );
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  clear(): void {
    for (const f of this.frames) {
      f.imageData.close();
    }
    this.frames = [];
  }

  getFrameCount(): number {
    return this.frames.length;
  }
}
