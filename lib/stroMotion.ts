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

function createSampleSurface(): ExtractionSurface {
  return createExtractionSurface(1, 1);
}

/** iOS Safari blob: URL requirements — call before sequential frame extraction. */
export function prepareVideoForStroMotionExtraction(video: HTMLVideoElement): void {
  video.preload = 'metadata';
  video.playsInline = true;
}

async function waitForVideoPaused(video: HTMLVideoElement): Promise<void> {
  video.pause();
  if (video.paused) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return;
  }
  await new Promise<void>((resolve) => {
    video.addEventListener('pause', () => resolve(), { once: true });
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function clampSeekTime(video: HTMLVideoElement, targetTime: number): number {
  if (!Number.isFinite(targetTime)) return 0;
  const max = Number.isFinite(video.duration) && video.duration > 0
    ? Math.max(0, video.duration - 1e-6)
    : targetTime;
  return Math.max(0, Math.min(targetTime, max));
}

async function seekVideoAndWait(video: HTMLVideoElement, targetTime: number): Promise<void> {
  const seekTarget = clampSeekTime(video, targetTime);
  if (Math.abs(video.currentTime - seekTarget) < 0.001) return;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 5000);

    const onSeeked = () => {
      cleanup();
      resolve();
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
    video.currentTime = seekTarget;
  });
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
  const seekTarget = clampSeekTime(video, targetTime);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Seek timeout at ${targetTime}s`));
    }, 5000);

    const drawFrame = () => {
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

    const onSeeked = () => {
      cleanup();
      drawFrame();
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

    if (Math.abs(video.currentTime - seekTarget) < 0.001) {
      cleanup();
      drawFrame();
      return;
    }

    video.currentTime = seekTarget;
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
  await waitForVideoPaused(video);

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
    try {
      await seekVideoAndWait(video, originalTime);
    } catch {
      video.currentTime = originalTime;
    }
    if (wasPlaying) void video.play();
  }

  return bitmaps;
}

/** Log center-pixel samples to detect stuck-frame extraction. */
export async function logStroMotionExtractDiagnostics(
  bitmaps: ImageBitmap[],
  times?: number[],
): Promise<void> {
  console.log(
    '[StroMotion] Extracted',
    bitmaps.length,
    'frames',
    times?.length ? `at times: ${times.map((t) => t.toFixed(3)).join(', ')}` : '',
  );

  const sampleCanvas = createSampleSurface();
  const sampleCtx = sampleCanvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!sampleCtx) {
    console.warn('[StroMotion] Could not create sample context for diagnostics');
    return;
  }

  bitmaps.forEach((bmp, i) => {
    const sx = Math.max(0, Math.floor(bmp.width / 2));
    const sy = Math.max(0, Math.floor(bmp.height / 2));
    sampleCtx.clearRect(0, 0, 1, 1);
    sampleCtx.drawImage(bmp, sx, sy, 1, 1, 0, 0, 1, 1);
    const px = sampleCtx.getImageData(0, 0, 1, 1).data;
    console.log(
      `[StroMotion] Frame ${i}${times?.[i] !== undefined ? ` @ ${times[i].toFixed(3)}s` : ''} center pixel: rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
    );
  });
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

export async function exportStroMotionPNGAfterRender(
  canvas: HTMLCanvasElement,
  filename = 'stromotion.png',
): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  exportStroMotionPNG(canvas, filename);
}

export function canvasSupportsVideoExport(canvas: HTMLCanvasElement): boolean {
  return typeof canvas.captureStream === 'function';
}

export async function exportStroMotionVideo(
  canvasEl: HTMLCanvasElement,
  options: {
    frameCount: number;
    intervalMs?: number;
    renderFrame: (visibleCount: number) => Promise<void>;
  },
): Promise<void> {
  const { frameCount, intervalMs = STRO_MOTION_ANIM_INTERVAL_MS, renderFrame } = options;
  if (frameCount <= 0) return;

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4';

  const stream = canvasEl.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  for (let visibleCount = 1; visibleCount <= frameCount; visibleCount++) {
    await renderFrame(visibleCount);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  await renderFrame(frameCount);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  recorder.stop();
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stromotion.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
  a.click();
  URL.revokeObjectURL(url);
}
