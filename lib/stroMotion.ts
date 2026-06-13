'use client';

export type StroMotionOpacityMode = 'uniform' | 'temporal';
export type StroMotionStatus = 'idle' | 'configuring' | 'extracting' | 'ready' | 'animating';

/** Video-normalized subject rectangle (0..1). */
export interface StroMotionSubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StroMotionResult {
  /** Full frame at start time — static background court/scene */
  baseFrame: ImageBitmap;
  /** Cropped athlete regions at each sample time */
  ghostCrops: ImageBitmap[];
  subjectBox: StroMotionSubjectBox;
  sampleTimes: number[];
}

export const STRO_MOTION_GHOST_COUNTS = [3, 5, 8, 10] as const;
export type StroMotionGhostCount = (typeof STRO_MOTION_GHOST_COUNTS)[number];
export const STRO_MOTION_DEFAULT_GHOST_COUNT: StroMotionGhostCount = 5;
export const STRO_MOTION_DEFAULT_OPACITY = 0.62;
export const STRO_MOTION_ANIM_INTERVAL_MS = 150;
/** Extra margin around the drawn box so racket / arms are not clipped during movement. */
export const STRO_MOTION_SUBJECT_PAD_RATIO = 0.12;
/** Minimum subject box size (video-normalized) for a full tennis stroke arc. */
export const STRO_MOTION_MIN_SUBJECT_WIDTH = 0.10;
export const STRO_MOTION_MIN_SUBJECT_HEIGHT = 0.22;

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

/** Convert { w, h } region from canvas selection to subject box (not yet padded). */
export function subjectBoxFromRegion(region: { x: number; y: number; w: number; h: number }): StroMotionSubjectBox {
  return { x: region.x, y: region.y, width: region.w, height: region.h };
}

/** Expand box outward (clamped to frame) for racket / arm / follow-through margin. */
export function expandSubjectBox(
  box: StroMotionSubjectBox,
  paddingRatio = STRO_MOTION_SUBJECT_PAD_RATIO,
): StroMotionSubjectBox {
  const padW = box.width * paddingRatio;
  const padH = box.height * paddingRatio;
  const x = Math.max(0, box.x - padW);
  const y = Math.max(0, box.y - padH);
  const width = Math.min(1 - x, box.width + padW * 2);
  const height = Math.min(1 - y, box.height + padH * 2);
  return { x, y, width, height };
}

/**
 * Apply padding + minimum size so forehand / serve / volley arcs stay inside the crop.
 * Call once when the user finishes drawing the subject box.
 */
export function normalizeSubjectBox(box: StroMotionSubjectBox): StroMotionSubjectBox {
  let { x, y, width, height } = expandSubjectBox(box);

  if (width < STRO_MOTION_MIN_SUBJECT_WIDTH) {
    const cx = x + width / 2;
    width = STRO_MOTION_MIN_SUBJECT_WIDTH;
    x = Math.max(0, Math.min(1 - width, cx - width / 2));
  }
  if (height < STRO_MOTION_MIN_SUBJECT_HEIGHT) {
    const cy = y + height / 2;
    height = STRO_MOTION_MIN_SUBJECT_HEIGHT;
    y = Math.max(0, Math.min(1 - height, cy - height / 2));
  }

  return { x, y, width, height };
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

/** Evenly spaced sample times from start through end (inclusive). */
export function computeGhostSampleTimes(
  startSec: number,
  endSec: number,
  ghostCount: number,
): number[] {
  if (ghostCount < 1 || endSec < startSec) return [];
  if (ghostCount === 1) return [startSec];
  const times: number[] = [];
  for (let i = 0; i < ghostCount; i++) {
    times.push(startSec + ((endSec - startSec) * i) / (ghostCount - 1));
  }
  return times;
}

function subjectBoxPixels(
  box: StroMotionSubjectBox,
  videoWidth: number,
  videoHeight: number,
): { px: number; py: number; pw: number; ph: number } {
  const px = Math.round(box.x * videoWidth);
  const py = Math.round(box.y * videoHeight);
  const pw = Math.max(1, Math.round(box.width * videoWidth));
  const ph = Math.max(1, Math.round(box.height * videoHeight));
  return {
    px: Math.max(0, Math.min(px, videoWidth - 1)),
    py: Math.max(0, Math.min(py, videoHeight - 1)),
    pw: Math.min(pw, videoWidth - px),
    ph: Math.min(ph, videoHeight - py),
  };
}

async function captureVideoToSurface(
  video: HTMLVideoElement,
  targetTime: number,
  offscreen: ExtractionSurface,
): Promise<void> {
  const seekTarget = clampSeekTime(video, targetTime);

  await new Promise<void>((resolve, reject) => {
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
        resolve();
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

export async function extractStroMotionComposite(
  video: HTMLVideoElement,
  startSec: number,
  endSec: number,
  ghostCount: number,
  subjectBox: StroMotionSubjectBox,
  onProgress?: (current: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<StroMotionResult | null> {
  const sampleTimes = computeGhostSampleTimes(startSec, endSec, ghostCount);
  if (sampleTimes.length === 0) return null;
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const cropBox = normalizeSubjectBox(subjectBox);

  prepareVideoForStroMotionExtraction(video);
  const wasPlaying = !video.paused;
  await waitForVideoPaused(video);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const offscreen = createExtractionSurface(vw, vh);
  const { px, py, pw, ph } = subjectBoxPixels(cropBox, vw, vh);
  const originalTime = video.currentTime;

  let baseFrame: ImageBitmap | null = null;
  const ghostCrops: ImageBitmap[] = [];

  try {
    await captureVideoToSurface(video, startSec, offscreen);
    if (isCancelled?.()) return null;
    baseFrame = await createImageBitmap(offscreen);
    onProgress?.(1, sampleTimes.length + 1);

    for (let i = 0; i < sampleTimes.length; i++) {
      if (isCancelled?.()) {
        if (baseFrame) baseFrame.close();
        ghostCrops.forEach((c) => c.close());
        return null;
      }

      await captureVideoToSurface(video, sampleTimes[i], offscreen);
      if (isCancelled?.()) {
        if (baseFrame) baseFrame.close();
        ghostCrops.forEach((c) => c.close());
        return null;
      }

      const crop = await createImageBitmap(offscreen, px, py, pw, ph);
      ghostCrops.push(crop);
      onProgress?.(i + 2, sampleTimes.length + 1);
    }

    return { baseFrame, ghostCrops, subjectBox: cropBox, sampleTimes };
  } catch {
    if (baseFrame) baseFrame.close();
    ghostCrops.forEach((c) => c.close());
    return null;
  } finally {
    try {
      await seekVideoAndWait(video, originalTime);
    } catch {
      video.currentTime = originalTime;
    }
    if (wasPlaying) void video.play();
  }
}

/** Log center-pixel samples on ghost crops to detect stuck-frame extraction. */
export async function logStroMotionExtractDiagnostics(result: StroMotionResult): Promise<void> {
  console.log(
    '[StroMotion] Composite ready:',
    result.ghostCrops.length,
    'ghost crops at times:',
    result.sampleTimes.map((t) => t.toFixed(3)).join(', '),
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

  result.ghostCrops.forEach((bmp, i) => {
    const sx = Math.max(0, Math.floor(bmp.width / 2));
    const sy = Math.max(0, Math.floor(bmp.height / 2));
    sampleCtx.clearRect(0, 0, 1, 1);
    sampleCtx.drawImage(bmp, sx, sy, 1, 1, 0, 0, 1, 1);
    const px = sampleCtx.getImageData(0, 0, 1, 1).data;
    console.log(
      `[StroMotion] Ghost ${i} @ ${result.sampleTimes[i]?.toFixed(3) ?? '?'}s crop center: rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
    );
  });
}

export interface StroMotionCompositeOptions {
  opacity?: number;
  fadeMode?: StroMotionOpacityMode;
  visibleCount?: number;
  dest: { x: number; y: number; w: number; h: number };
}

/** Draw base background + subject ghost crops (Dartfish-style). */
export function renderStroMotionComposite(
  ctx: CanvasRenderingContext2D,
  result: StroMotionResult,
  options: StroMotionCompositeOptions,
): void {
  const {
    opacity = STRO_MOTION_DEFAULT_OPACITY,
    fadeMode = 'temporal',
    visibleCount = result.ghostCrops.length,
    dest,
  } = options;

  const count = Math.min(visibleCount, result.ghostCrops.length);
  if (count <= 0) return;

  const boxX = dest.x + result.subjectBox.x * dest.w;
  const boxY = dest.y + result.subjectBox.y * dest.h;
  const boxW = result.subjectBox.width * dest.w;
  const boxH = result.subjectBox.height * dest.h;

  ctx.save();

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(result.baseFrame, dest.x, dest.y, dest.w, dest.h);

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    if (isLast) {
      ctx.globalAlpha = 1.0;
    } else if (fadeMode === 'temporal') {
      // Earliest ghost (i=0) lightest → latest non-final darker → final at 100%.
      ctx.globalAlpha = opacity * ((i + 1) / Math.max(1, result.ghostCrops.length));
    } else {
      ctx.globalAlpha = opacity;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(result.ghostCrops[i], boxX, boxY, boxW, boxH);
  }

  ctx.restore();
}

export function clearStroMotionResult(result: StroMotionResult | null): void {
  if (!result) return;
  result.baseFrame.close();
  result.ghostCrops.forEach((c) => c.close());
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
  waitForPaint?: () => Promise<void>,
): Promise<void> {
  if (waitForPaint) {
    await waitForPaint();
    await waitForPaint();
  } else {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
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
