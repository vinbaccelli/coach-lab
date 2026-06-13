'use client';

export type StroMotionOpacityMode = 'uniform' | 'temporal';
export type StroMotionRenderMode = 'static' | 'animated';
export type StroMotionSamplingMode = 'auto' | 'manual';
export type StroMotionStatus = 'idle' | 'configuring' | 'extracting' | 'ready' | 'animating';

export interface StroMotionConfig {
  enabled: boolean;
  startFrame: number;
  endFrame: number;
  ghostCount: number;
  opacity: number;
  region?: { x: number; y: number; w: number; h: number };
}

export const STRO_MOTION_MAX_FRAMES = 20;
export const STRO_MOTION_MIN_FRAMES = 2;
export const STRO_MOTION_DEFAULT_OPACITY = 0.6;
export const STRO_MOTION_ANIM_INTERVAL_MS = 150;

type ExtractionSurface = OffscreenCanvas | HTMLCanvasElement;

function createExtractionSurface(width: number, height: number): ExtractionSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** iOS Safari blob: URL requirements — call before sequential frame extraction. */
export function prepareVideoForStroMotionExtraction(video: HTMLVideoElement): void {
  video.preload = 'metadata';
  video.playsInline = true;
}

/** Compute evenly-spaced sample times inside [startSec, endSec] (inclusive). */
export function computeAutoSampleTimes(
  startSec: number,
  endSec: number,
  intervalFrames: number,
  fps: number,
  maxFrames = STRO_MOTION_MAX_FRAMES,
): number[] {
  if (endSec <= startSec || intervalFrames < 1 || fps < 1) return [];
  const stepSec = intervalFrames / fps;
  const times: number[] = [];
  for (let t = startSec; t <= endSec + 1e-6 && times.length < maxFrames; t += stepSec) {
    times.push(Math.min(endSec, t));
  }
  if (times.length === 0) times.push(startSec);
  if (times[times.length - 1] < endSec - 1e-6 && times.length < maxFrames) {
    times.push(endSec);
  }
  return times;
}

export async function extractFrameAtTime(
  video: HTMLVideoElement,
  targetTime: number,
  offscreen: ExtractionSurface,
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Seek timeout at ${targetTime}s`));
    }, 5000);

    const onSeeked = () => {
      cleanup();
      // On iOS Safari with Blob URLs, frame data may lag behind seeked event
      requestAnimationFrame(() => {
        const ctx = offscreen.getContext('2d') as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (!ctx) {
          reject(new Error('2D context unavailable'));
          return;
        }
        ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        void createImageBitmap(offscreen).then(resolve).catch(reject);
      });
    };

    const onError = () => {
      cleanup();
      reject(new Error('Seek error'));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = targetTime;
  });
}

export async function extractAllFrames(
  video: HTMLVideoElement,
  times: number[],
  onProgress?: (n: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<ImageBitmap[]> {
  prepareVideoForStroMotionExtraction(video);

  const wasPlaying = !video.paused;
  video.pause();

  const offscreen = createExtractionSurface(video.videoWidth, video.videoHeight);
  const bitmaps: ImageBitmap[] = [];
  const originalTime = video.currentTime;

  try {
    for (let i = 0; i < times.length; i++) {
      if (isCancelled?.()) {
        bitmaps.forEach((b) => b.close());
        return [];
      }

      const bitmap = await extractFrameAtTime(video, times[i], offscreen);
      if (isCancelled?.()) {
        bitmap.close();
        bitmaps.forEach((b) => b.close());
        return [];
      }

      bitmaps.push(bitmap);
      onProgress?.(i + 1, times.length);
    }
  } finally {
    video.currentTime = originalTime;
    if (wasPlaying) void video.play();
  }

  return bitmaps;
}

export interface StroMotionCompositeOptions {
  opacity: number;
  fadeMode: StroMotionOpacityMode;
  visibleCount?: number;
  /** Letterbox destination rect; defaults to full canvas */
  dest?: { x: number; y: number; w: number; h: number };
}

export function renderStroMotionComposite(
  ctx: CanvasRenderingContext2D,
  frames: ImageBitmap[],
  options: StroMotionCompositeOptions,
): void {
  const { opacity, fadeMode, visibleCount = frames.length, dest } = options;
  const count = Math.min(visibleCount, frames.length);
  if (count <= 0) return;

  const dx = dest?.x ?? 0;
  const dy = dest?.y ?? 0;
  const dw = dest?.w ?? ctx.canvas.width;
  const dh = dest?.h ?? ctx.canvas.height;

  ctx.save();

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;

    if (isLast) {
      ctx.globalAlpha = 1.0;
    } else if (fadeMode === 'temporal') {
      ctx.globalAlpha = opacity * ((i + 1) / frames.length);
    } else {
      ctx.globalAlpha = opacity;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(frames[i], dx, dy, dw, dh);
  }

  ctx.restore();
}

export function clearFrames(frames: ImageBitmap[]): void {
  frames.forEach((b) => b.close());
}

export function exportStroMotionPNG(canvas: HTMLCanvasElement, filename = 'stromotion.png'): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
