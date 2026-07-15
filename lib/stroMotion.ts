'use client';

import { acquirePoseDetector } from '@/lib/sharedPoseDetector';
import { matteRacketFrame } from '@/lib/objectMultiplier';
import {
  clampPixelRect,
  countSuccessfulPoses,
  ensureRegionContainsAllPoses,
  buildStroMotionValidationReport,
  logStroMotionValidationReport,
  poseBodyUnionRect,
  racketZoneUnionRect,
  type PixelRect,
  type StroMotionPoseKeypoint,
  type StroMotionValidationReport,
  unionPixelRect,
} from '@/lib/stroMotionPose';
import {
  analyzeLayerRacketVisibility,
  buildExportParityReport,
  buildGhostLayerMask,
  buildVisualQualityScorecard,
  createEmptyExportParity,
  logVisualQualityScorecard,
  updateExportParity,
  validateServeStress,
  type ExportParityReport,
  type GhostRacketValidation,
  type MaskQualityMetrics,
  type PerformanceTimings,
  type ServeStressFrame,
  type VisualQualityScorecard,
} from '@/lib/stroMotionVisualQuality';

export {
  hashCanvasContent,
  buildExportParityReport,
  logVisualQualityScorecard,
  updateExportParity,
  type ExportParityReport,
} from '@/lib/stroMotionVisualQuality';

/** Mutable export parity state — updated at preview/export time (console diagnostics). */
let stroMotionPreviewHash: string | null = null;

export function setStroMotionPreviewHash(hash: string | null): void {
  stroMotionPreviewHash = hash;
}

export function getStroMotionPreviewHash(): string | null {
  return stroMotionPreviewHash;
}

export function recordExportParity(
  existing: ExportParityReport,
  kind: 'preview' | 'png' | 'video',
  hash: string,
): ExportParityReport {
  const patch =
    kind === 'preview' ? { previewHash: hash }
      : kind === 'png' ? { pngHash: hash }
        : { videoFrameHash: hash };
  const next = updateExportParity(existing, patch);
  if (next.mismatches.length > 0) {
    console.warn('[StroMotion] Export parity mismatch:', next.mismatches);
  } else if (next.previewHash && (next.pngHash || next.videoFrameHash)) {
    console.log('[StroMotion] Export parity: PASS', {
      preview: next.previewHash,
      png: next.pngHash,
      video: next.videoFrameHash,
    });
  }
  return next;
}

export type StroMotionOpacityMode = 'uniform' | 'temporal';
export type StroMotionStatus = 'idle' | 'configuring' | 'extracting' | 'ready' | 'animating';
export type StroMotionMode = 'athlete' | 'object';
export const STRO_MOTION_DEFAULT_MODE: StroMotionMode = 'athlete';

/** Video-normalized subject rectangle (0..1). */
export interface StroMotionSubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StroMotionDiagnostics {
  extractionTimeMs: number;
  poseSuccessRate: number;
  maskCoveragePercent: number[];
  effectiveBox: StroMotionSubjectBox;
  sampleTimes: number[];
  validation: StroMotionValidationReport;
  maskQuality: MaskQualityMetrics[];
  ghostRacketValidation: GhostRacketValidation[];
  serveStress: ServeStressFrame[];
  serveWarnings: string[];
  timings: PerformanceTimings;
  visualQuality: VisualQualityScorecard;
  exportParity: ExportParityReport;
}

export interface StroMotionResult {
  /** Full frame at start time — static background court/scene */
  baseFrame: ImageBitmap;
  /** Full-frame transparent player cutouts (video dimensions) */
  ghostLayers: ImageBitmap[];
  /** Effective extraction region (padded + pose + motion union) */
  subjectBox: StroMotionSubjectBox;
  sampleTimes: number[];
  /** Pose per ghost sample (video pixel coords) */
  ghostPoses: (StroMotionPoseKeypoint[] | null)[];
  /** Object matting vs full-body pose masking */
  extractionMode?: StroMotionExtractionMode;
  /** Per-frame object boxes used for object-mode ghosts */
  frameBoxes?: StroMotionSubjectBox[];
  diagnostics: StroMotionDiagnostics;
}

/** @deprecated use ghostLayers */
export type StroMotionResultLegacy = StroMotionResult & { ghostCrops?: ImageBitmap[] };

export const STRO_MOTION_GHOST_COUNTS = [3, 5, 8, 10] as const;
export type StroMotionGhostCount = (typeof STRO_MOTION_GHOST_COUNTS)[number];
export const STRO_MOTION_DEFAULT_GHOST_COUNT: StroMotionGhostCount = 5;
export const STRO_MOTION_DEFAULT_OPACITY = 0.62;
export const STRO_MOTION_ANIM_INTERVAL_MS = 150;
export const STRO_MOTION_VIDEO_FINAL_HOLD_MS = 2000;
export const STRO_MOTION_EXTRACT_CONCURRENCY = 3;
/** Extra margin around the drawn box so racket / arms are not clipped during movement. */
export const STRO_MOTION_SUBJECT_PAD_RATIO = 0.20;
export const STRO_MOTION_MIN_SUBJECT_WIDTH = 0.10;
export const STRO_MOTION_MIN_SUBJECT_HEIGHT = 0.22;
/** Tighter bounds for object-only selection (racket, ball, club, etc.). */
export const STRO_MOTION_OBJECT_PAD_RATIO = 0.08;
export const STRO_MOTION_MIN_OBJECT_WIDTH = 0.025;
export const STRO_MOTION_MIN_OBJECT_HEIGHT = 0.035;

export type StroMotionExtractionMode = 'object' | 'subject';

const STRO_MOTION_MOTION_DIFF_THRESHOLD = 20;
const STRO_MOTION_MOTION_UNION_PAD_PX = 8;
const STRO_MOTION_EDGE_EXPAND_RATIO = 0.18;
const STRO_MOTION_EDGE_TOUCH_PX = 4;

type ExtractionSurface = OffscreenCanvas | HTMLCanvasElement;
type CanvasCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface CapturedFrame {
  time: number;
  imageData: ImageData;
}

function createExtractionSurface(width: number, height: number): ExtractionSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function subjectBoxFromRegion(region: { x: number; y: number; w: number; h: number }): StroMotionSubjectBox {
  return { x: region.x, y: region.y, width: region.w, height: region.h };
}

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

export function normalizeObjectBox(box: StroMotionSubjectBox): StroMotionSubjectBox {
  let { x, y, width, height } = expandSubjectBox(box, STRO_MOTION_OBJECT_PAD_RATIO);

  if (width < STRO_MOTION_MIN_OBJECT_WIDTH) {
    const cx = x + width / 2;
    width = STRO_MOTION_MIN_OBJECT_WIDTH;
    x = Math.max(0, Math.min(1 - width, cx - width / 2));
  }
  if (height < STRO_MOTION_MIN_OBJECT_HEIGHT) {
    const cy = y + height / 2;
    height = STRO_MOTION_MIN_OBJECT_HEIGHT;
    y = Math.max(0, Math.min(1 - height, cy - height / 2));
  }

  return { x, y, width, height };
}

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

/** Dartfish opacity: oldest 20%, middle 35–80%, final 100%. Newest draws on top. */
export function temporalGhostOpacity(_index: number, _total: number): number {
  return 1.0;
}

export function stroMotionCacheKey(params: {
  subjectBox: StroMotionSubjectBox;
  startSec: number;
  endSec: number;
  ghostCount: number;
}): string {
  return JSON.stringify(params);
}

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

/**
 * Change the NUMBER of sample times without moving the ones that already exist.
 * Adding frames inserts new times at the midpoint of the widest gap (so every
 * existing snapshot — and its mask — keeps its exact position); removing frames
 * drops the most redundant interior time (closest to a neighbour) while keeping
 * the endpoints. Falls back to even spacing only when there's nothing to keep.
 *
 * This replaces the old "re-space everything evenly on any count change", which
 * moved every frame and made the draft-sync merge drop the coach's masks.
 */
export function resizeSampleTimes(
  times: number[],
  targetCount: number,
  startSec: number,
  endSec: number,
): number[] {
  if (targetCount < 1 || endSec < startSec) return [];
  const result = times.filter((t) => Number.isFinite(t)).slice().sort((a, b) => a - b);
  if (result.length === 0) return computeGhostSampleTimes(startSec, endSec, targetCount);

  // Grow: insert at the midpoint of the widest gap, one at a time.
  while (result.length < targetCount) {
    if (result.length === 1) {
      result.push(result[0] < (startSec + endSec) / 2 ? endSec : startSec);
      result.sort((a, b) => a - b);
      continue;
    }
    let gi = 0;
    let widest = -1;
    for (let i = 0; i < result.length - 1; i++) {
      const gap = result[i + 1] - result[i];
      if (gap > widest) { widest = gap; gi = i; }
    }
    result.splice(gi + 1, 0, (result[gi] + result[gi + 1]) / 2);
  }

  // Shrink: drop the interior time whose neighbours are closest; keep endpoints.
  while (result.length > targetCount && result.length > 2) {
    let ri = 1;
    let tightest = Infinity;
    for (let i = 1; i < result.length - 1; i++) {
      const gap = Math.min(result[i] - result[i - 1], result[i + 1] - result[i]);
      if (gap < tightest) { tightest = gap; ri = i; }
    }
    result.splice(ri, 1);
  }
  if (result.length > targetCount) result.length = targetCount; // count 1/2 edge

  return result;
}

/** Keep sample times inside trim and minimally spaced when dragging markers. */
export function enforceMonotonicSampleTimes(
  times: number[],
  trimStartSec: number,
  trimEndSec: number,
): number[] {
  const span = trimEndSec - trimStartSec;
  const minGap = span > 0 ? Math.min(0.04, span / (times.length * 3)) : 0.01;
  let prev = trimStartSec - minGap;
  return times.map((t) => {
    const clamped = Math.max(trimStartSec, Math.min(trimEndSec, Math.max(t, prev + minGap)));
    const next = Math.round(clamped * 1000) / 1000;
    prev = next;
    return next;
  });
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

function subjectBoxFromPixels(
  px: number,
  py: number,
  pw: number,
  ph: number,
  videoWidth: number,
  videoHeight: number,
): StroMotionSubjectBox {
  return {
    x: px / videoWidth,
    y: py / videoHeight,
    width: pw / videoWidth,
    height: ph / videoHeight,
  };
}

function pixelRectToSubjectBox(rect: PixelRect, vw: number, vh: number): StroMotionSubjectBox {
  return subjectBoxFromPixels(
    rect.x0,
    rect.y0,
    rect.x1 - rect.x0,
    rect.y1 - rect.y0,
    vw,
    vh,
  );
}

function expandCropForEdgeMotion(
  rect: PixelRect,
  cropW: number,
  cropH: number,
  touchesLeft: boolean,
  touchesTop: boolean,
  touchesRight: boolean,
  touchesBottom: boolean,
  vw: number,
  vh: number,
): PixelRect {
  let { x0, y0, x1, y1 } = rect;
  if (touchesLeft) x0 -= Math.round(cropW * STRO_MOTION_EDGE_EXPAND_RATIO);
  if (touchesRight) x1 += Math.round(cropW * STRO_MOTION_EDGE_EXPAND_RATIO);
  if (touchesTop) y0 -= Math.round(cropH * STRO_MOTION_EDGE_EXPAND_RATIO);
  if (touchesBottom) y1 += Math.round(cropH * STRO_MOTION_EDGE_EXPAND_RATIO);
  return clampPixelRect({ x0, y0, x1, y1 }, vw, vh);
}

function computeMotionBoundsInCrop(
  baseData: ImageData,
  currentData: ImageData,
): { x: number; y: number; w: number; h: number; touchesEdge: boolean } | null {
  const { width, height } = baseData;
  if (width !== currentData.width || height !== currentData.height) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const diff =
        Math.abs(currentData.data[i] - baseData.data[i]) +
        Math.abs(currentData.data[i + 1] - baseData.data[i + 1]) +
        Math.abs(currentData.data[i + 2] - baseData.data[i + 2]);
      if (diff >= STRO_MOTION_MOTION_DIFF_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    touchesEdge:
      minX <= STRO_MOTION_EDGE_TOUCH_PX ||
      minY <= STRO_MOTION_EDGE_TOUCH_PX ||
      maxX >= width - 1 - STRO_MOTION_EDGE_TOUCH_PX ||
      maxY >= height - 1 - STRO_MOTION_EDGE_TOUCH_PX,
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
        const ctx = offscreen.getContext('2d') as CanvasCtx | null;
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

async function detectPoseOnSurface(
  surface: ExtractionSurface,
  detector: Awaited<ReturnType<typeof acquirePoseDetector>>,
): Promise<StroMotionPoseKeypoint[] | null> {
  try {
    const poses = await detector.estimatePoses(surface, { flipHorizontal: false });
    const raw = poses?.[0]?.keypoints as Array<{ x: number; y: number; score?: number; name?: string }> | undefined;
    if (!raw?.length) return null;
    return raw.map((kp) => ({
      x: kp.x,
      y: kp.y,
      score: kp.score ?? 0,
      name: kp.name ?? '',
    }));
  } catch {
    return null;
  }
}

function cropImageData(
  full: ImageData,
  px: number,
  py: number,
  pw: number,
  ph: number,
): ImageData {
  const cropped = new ImageData(pw, ph);
  const src = full.data;
  const dst = cropped.data;
  const fullW = full.width;

  for (let y = 0; y < ph; y++) {
    const srcRow = (py + y) * fullW + px;
    const dstRow = y * pw;
    for (let x = 0; x < pw; x++) {
      const srcI = (srcRow + x) * 4;
      const dstI = (dstRow + x) * 4;
      dst[dstI] = src[srcI];
      dst[dstI + 1] = src[srcI + 1];
      dst[dstI + 2] = src[srcI + 2];
      dst[dstI + 3] = src[srcI + 3];
    }
  }

  return cropped;
}

function createPoseSurfacePool(
  count: number,
  width: number,
  height: number,
): ExtractionSurface[] {
  return Array.from({ length: count }, () => createExtractionSurface(width, height));
}

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function imageDataToBitmap(data: ImageData): Promise<ImageBitmap> {
  const canvas = createExtractionSurface(data.width, data.height);
  const ctx = canvas.getContext('2d') as CanvasCtx | null;
  if (!ctx) return createImageBitmap(createExtractionSurface(1, 1));
  ctx.putImageData(data, 0, 0);
  return createImageBitmap(canvas);
}

async function buildObjectGhostLayer(
  source: ExtractionSurface,
  objectBox: StroMotionSubjectBox,
  vw: number,
  vh: number,
): Promise<ImageBitmap> {
  const { px, py, pw, ph } = subjectBoxPixels(objectBox, vw, vh);
  let cropBitmap = await createImageBitmap(source, px, py, pw, ph);
  const matted = await matteRacketFrame(cropBitmap);
  cropBitmap.close();

  const layer = createExtractionSurface(vw, vh);
  const lctx = layer.getContext('2d') as CanvasCtx | null;
  if (!lctx) {
    matted.close();
    return createImageBitmap(createExtractionSurface(1, 1));
  }
  lctx.clearRect(0, 0, vw, vh);
  lctx.drawImage(matted, px, py, pw, ph);
  matted.close();
  return createImageBitmap(layer);
}

/** Object-multiplier extraction: matte the selected object region at each sample time. */
export async function extractStroMotionObjectComposite(
  video: HTMLVideoElement,
  startSec: number,
  endSec: number,
  ghostCount: number,
  objectBox: StroMotionSubjectBox,
  onProgress?: (current: number, total: number) => void,
  isCancelled?: () => boolean,
  precomputedSampleTimes?: number[],
  perFrameBoxes?: Array<{ timeSec: number; box: StroMotionSubjectBox }>,
): Promise<StroMotionResult | null> {
  const t0 = performance.now();
  const sampleTimes = precomputedSampleTimes?.length
    ? precomputedSampleTimes
    : computeGhostSampleTimes(startSec, endSec, ghostCount);
  if (sampleTimes.length === 0) return null;
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const frameBoxes = perFrameBoxes?.length === sampleTimes.length
    ? perFrameBoxes
    : sampleTimes.map((timeSec) => ({
        timeSec,
        box: normalizeObjectBox(objectBox),
      }));

  prepareVideoForStroMotionExtraction(video);
  const wasPlaying = !video.paused;
  await waitForVideoPaused(video);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const offscreen = createExtractionSurface(vw, vh);
  const ctx = offscreen.getContext('2d') as CanvasCtx | null;
  if (!ctx) return null;

  const originalTime = video.currentTime;
  const totalSteps = sampleTimes.length + 2;

  let baseFrame: ImageBitmap | null = null;
  let ghostLayers: ImageBitmap[] = [];
  const effectiveBoxes: StroMotionSubjectBox[] = [];

  try {
    await captureVideoToSurface(video, startSec, offscreen);
    if (isCancelled?.()) return null;
    baseFrame = await createImageBitmap(offscreen);
    onProgress?.(1, totalSteps);

    for (let i = 0; i < sampleTimes.length; i++) {
      if (isCancelled?.()) return null;
      const { timeSec, box } = frameBoxes[i];
      await captureVideoToSurface(video, timeSec, offscreen);
      if (isCancelled?.()) return null;
      const normalized = normalizeObjectBox(box);
      effectiveBoxes.push(normalized);
      const layer = await buildObjectGhostLayer(offscreen, normalized, vw, vh);
      ghostLayers.push(layer);
      onProgress?.(2 + i, totalSteps);
    }

    const unionBox = effectiveBoxes.reduce(
      (acc, b) => ({
        x: Math.min(acc.x, b.x),
        y: Math.min(acc.y, b.y),
        width: Math.max(acc.x + acc.width, b.x + b.width) - Math.min(acc.x, b.x),
        height: Math.max(acc.y + acc.height, b.y + b.height) - Math.min(acc.y, b.y),
      }),
      effectiveBoxes[0] ?? normalizeObjectBox(objectBox),
    );

    const extractionTimeMs = Math.round(performance.now() - t0);
    const { px, py, pw, ph } = subjectBoxPixels(unionBox, vw, vh);
    const coachRect: PixelRect = { x0: px, y0: py, x1: px + pw, y1: py + ph };
    const validation = buildStroMotionValidationReport(
      coachRect,
      coachRect,
      coachRect,
      null,
      null,
      null,
      sampleTimes,
      ghostLayers.map(() => null),
      vw,
      vh,
    );

    return {
      baseFrame,
      ghostLayers,
      subjectBox: unionBox,
      sampleTimes,
      ghostPoses: sampleTimes.map(() => null),
      extractionMode: 'object',
      frameBoxes: effectiveBoxes,
      diagnostics: {
        extractionTimeMs,
        poseSuccessRate: 0,
        maskCoveragePercent: ghostLayers.map(() => 100),
        effectiveBox: unionBox,
        sampleTimes,
        validation,
        maskQuality: [],
        ghostRacketValidation: [],
        serveStress: [],
        serveWarnings: [],
        timings: {
          captureMs: extractionTimeMs,
          poseMs: 0,
          regionMs: 0,
          maskMs: extractionTimeMs,
          bitmapMs: 0,
          totalMs: extractionTimeMs,
        },
        visualQuality: buildVisualQualityScorecard({
          maskMetrics: [],
          ghostRacket: [],
          serveWarnings: [],
          hasOverhead: false,
          exportParity: null,
          avgForegroundLeakage: 0,
          avgBackgroundLeakage: 0,
        }),
        exportParity: createEmptyExportParity(),
      },
    };
  } catch {
    if (baseFrame) baseFrame.close();
    ghostLayers.forEach((c) => c.close());
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

export async function extractStroMotionComposite(
  video: HTMLVideoElement,
  startSec: number,
  endSec: number,
  ghostCount: number,
  subjectBox: StroMotionSubjectBox,
  onProgress?: (current: number, total: number) => void,
  isCancelled?: () => boolean,
  precomputedSampleTimes?: number[],
): Promise<StroMotionResult | null> {
  const t0 = performance.now();
  const sampleTimes = precomputedSampleTimes?.length
    ? precomputedSampleTimes
    : computeGhostSampleTimes(startSec, endSec, ghostCount);
  if (sampleTimes.length === 0) return null;
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const initialBox = normalizeSubjectBox(subjectBox);
  prepareVideoForStroMotionExtraction(video);
  const wasPlaying = !video.paused;
  await waitForVideoPaused(video);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const offscreen = createExtractionSurface(vw, vh);
  const ctx = offscreen.getContext('2d') as CanvasCtx | null;
  if (!ctx) return null;

  const { px, py, pw, ph } = subjectBoxPixels(initialBox, vw, vh);
  const originalTime = video.currentTime;
  const totalSteps = sampleTimes.length * 2 + 2;

  let baseFrame: ImageBitmap | null = null;
  let ghostLayers: ImageBitmap[] = [];
  let ghostPoses: (StroMotionPoseKeypoint[] | null)[] = [];
  let maskCoveragePercent: number[] = [];

  let maskQualityMetrics: MaskQualityMetrics[] = [];
  let ghostRacketValidation: GhostRacketValidation[] = [];

  const timings: PerformanceTimings = {
    captureMs: 0,
    poseMs: 0,
    regionMs: 0,
    maskMs: 0,
    bitmapMs: 0,
    totalMs: 0,
  };

  try {
    const detector = await acquirePoseDetector();
    if (isCancelled?.()) return null;

    let tCapture = performance.now();
    await captureVideoToSurface(video, startSec, offscreen);
    if (isCancelled?.()) return null;
    const baseImageData = ctx.getImageData(0, 0, vw, vh);
    onProgress?.(1, totalSteps);

    const captured: CapturedFrame[] = [];
    for (let i = 0; i < sampleTimes.length; i++) {
      if (isCancelled?.()) return null;
      await captureVideoToSurface(video, sampleTimes[i], offscreen);
      if (isCancelled?.()) return null;
      captured.push({ time: sampleTimes[i], imageData: ctx.getImageData(0, 0, vw, vh) });
      onProgress?.(2 + i, totalSteps);
    }
    timings.captureMs = Math.round(performance.now() - tCapture);

    const tPose = performance.now();
    const poseSurfaces = createPoseSurfacePool(STRO_MOTION_EXTRACT_CONCURRENCY, vw, vh);
    ghostPoses = await processWithConcurrency(
      captured,
      STRO_MOTION_EXTRACT_CONCURRENCY,
      async (frame, index) => {
        const surface = poseSurfaces[index % poseSurfaces.length];
        const sctx = surface.getContext('2d') as CanvasCtx;
        sctx.putImageData(frame.imageData, 0, 0);
        return detectPoseOnSurface(surface, detector);
      },
    );
    timings.poseMs = Math.round(performance.now() - tPose);
    onProgress?.(2 + sampleTimes.length, totalSteps);

    const tRegion = performance.now();
    const baseCrop = cropImageData(baseImageData, px, py, pw, ph);

    let motionUnion: PixelRect = { x0: px, y0: py, x1: px + pw, y1: py + ph };
    const coachRect: PixelRect = { x0: px, y0: py, x1: px + pw, y1: py + ph };
    let motionOnlyUnion: PixelRect | null = null;
    let poseOnlyGlobal: PixelRect | null = null;
    let racketOnlyGlobal: PixelRect | null = null;
    let edgeL = false;
    let edgeT = false;
    let edgeR = false;
    let edgeB = false;

    for (let i = 0; i < captured.length; i++) {
      const cropData = cropImageData(captured[i].imageData, px, py, pw, ph);

      const motion = computeMotionBoundsInCrop(baseCrop, cropData);
      if (motion) {
        const pad = STRO_MOTION_MOTION_UNION_PAD_PX;
        const motionRect: PixelRect = {
          x0: px + Math.max(0, motion.x - pad),
          y0: py + Math.max(0, motion.y - pad),
          x1: px + motion.x + motion.w + pad,
          y1: py + motion.y + motion.h + pad,
        };
        motionOnlyUnion = motionOnlyUnion
          ? unionPixelRect(motionOnlyUnion, motionRect)
          : motionRect;
        motionUnion = unionPixelRect(motionUnion, motionRect);
        if (motion.touchesEdge) {
          if (motion.x <= STRO_MOTION_EDGE_TOUCH_PX) edgeL = true;
          if (motion.y <= STRO_MOTION_EDGE_TOUCH_PX) edgeT = true;
          if (motion.x + motion.w >= pw - STRO_MOTION_EDGE_TOUCH_PX) edgeR = true;
          if (motion.y + motion.h >= ph - STRO_MOTION_EDGE_TOUCH_PX) edgeB = true;
        }
      }

      const bodyRect = poseBodyUnionRect(ghostPoses[i], vw, vh);
      if (bodyRect) {
        poseOnlyGlobal = poseOnlyGlobal
          ? unionPixelRect(poseOnlyGlobal, bodyRect)
          : bodyRect;
        motionUnion = unionPixelRect(motionUnion, bodyRect);
      }

      const racketRect = racketZoneUnionRect(ghostPoses[i], vw, vh);
      if (racketRect) {
        racketOnlyGlobal = racketOnlyGlobal
          ? unionPixelRect(racketOnlyGlobal, racketRect)
          : racketRect;
        motionUnion = unionPixelRect(motionUnion, racketRect);
      }
    }

    const beforeEdgeRect = { ...motionUnion };
    if (edgeL || edgeT || edgeR || edgeB) {
      motionUnion = expandCropForEdgeMotion(motionUnion, pw, ph, edgeL, edgeT, edgeR, edgeB, vw, vh);
    }

    motionUnion = ensureRegionContainsAllPoses(motionUnion, ghostPoses, vw, vh);
    motionUnion = clampPixelRect(motionUnion, vw, vh);
    const effectiveBox = pixelRectToSubjectBox(motionUnion, vw, vh);

    const validation = buildStroMotionValidationReport(
      coachRect,
      motionUnion,
      beforeEdgeRect,
      poseOnlyGlobal,
      racketOnlyGlobal,
      motionOnlyUnion,
      sampleTimes,
      ghostPoses,
      vw,
      vh,
    );
    logStroMotionValidationReport(validation);
    timings.regionMs = Math.round(performance.now() - tRegion);

    const serveStress = validateServeStress(ghostPoses, sampleTimes, motionUnion, vw, vh);

    const tMask = performance.now();
    const layerResults = await processWithConcurrency(
      captured,
      STRO_MOTION_EXTRACT_CONCURRENCY,
      async (frame, i) => {
        const { layer, metrics } = buildGhostLayerMask(
          frame.imageData,
          baseImageData,
          ghostPoses[i],
          motionUnion,
          vw,
          vh,
        );
        const tBmp = performance.now();
        const bitmap = await imageDataToBitmap(layer);
        const bmpMs = performance.now() - tBmp;
        return { bitmap, metrics, bmpMs, layer };
      },
    );
    timings.maskMs = Math.round(performance.now() - tMask);
    timings.bitmapMs = Math.round(
      layerResults.reduce((s, r) => s + r.bmpMs, 0),
    );

    ghostLayers = layerResults.map((r) => r.bitmap);
    maskQualityMetrics = layerResults.map((r) => r.metrics);
    maskCoveragePercent = maskQualityMetrics.map((m) => m.coveragePercent);

    ghostRacketValidation = layerResults.map((r, i) => {
      const prevCov = i > 0 ? maskCoveragePercent[i - 1] : maskCoveragePercent[i];
      const nextCov = i < layerResults.length - 1 ? maskCoveragePercent[i + 1] : maskCoveragePercent[i];
      const neighborCoverage = (prevCov + nextCov) / 2;
      return analyzeLayerRacketVisibility(
        r.layer,
        ghostPoses[i],
        i,
        sampleTimes[i] ?? 0,
        maskCoveragePercent[i],
        neighborCoverage,
        vw,
        vh,
      );
    });

    const tBaseBmp = performance.now();
    baseFrame = await imageDataToBitmap(baseImageData);
    timings.bitmapMs += Math.round(performance.now() - tBaseBmp);
    onProgress?.(totalSteps, totalSteps);

    timings.totalMs = Math.round(performance.now() - t0);
    const extractionTimeMs = timings.totalMs;
    const poseSuccessRate = sampleTimes.length > 0
      ? (countSuccessfulPoses(ghostPoses) / sampleTimes.length) * 100
      : 0;

    const avgFgLeak =
      maskQualityMetrics.reduce((s, m) => s + m.foregroundLeakagePercent, 0) /
      Math.max(1, maskQualityMetrics.length);
    const avgBgLeak =
      maskQualityMetrics.reduce((s, m) => s + m.backgroundLeakagePercent, 0) /
      Math.max(1, maskQualityMetrics.length);

    const visualQuality = buildVisualQualityScorecard({
      maskMetrics: maskQualityMetrics,
      ghostRacket: ghostRacketValidation,
      serveWarnings: serveStress.warnings,
      hasOverhead: serveStress.hasOverhead,
      exportParity: null,
      avgForegroundLeakage: avgFgLeak,
      avgBackgroundLeakage: avgBgLeak,
    });

    logVisualQualityScorecard(
      visualQuality,
      maskQualityMetrics,
      ghostRacketValidation,
      timings,
      serveStress.frames,
      null,
    );

    return {
      baseFrame,
      ghostLayers,
      subjectBox: effectiveBox,
      sampleTimes,
      ghostPoses,
      extractionMode: 'subject',
      diagnostics: {
        extractionTimeMs,
        poseSuccessRate,
        maskCoveragePercent,
        effectiveBox,
        sampleTimes,
        validation,
        maskQuality: maskQualityMetrics,
        ghostRacketValidation,
        serveStress: serveStress.frames,
        serveWarnings: serveStress.warnings,
        timings,
        visualQuality,
        exportParity: createEmptyExportParity(),
      },
    };
  } catch {
    if (baseFrame) baseFrame.close();
    ghostLayers.forEach((c) => c.close());
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

export async function logStroMotionExtractDiagnostics(result: StroMotionResult): Promise<void> {
  console.log('[StroMotion] Composite ready:', {
    mode: result.extractionMode ?? 'unknown',
    ghosts: result.ghostLayers.length,
    times: result.sampleTimes.map((t) => t.toFixed(3)),
    effectiveBox: result.subjectBox,
    poseSuccessRate: `${result.diagnostics.poseSuccessRate.toFixed(0)}%`,
    validationPass: result.diagnostics.validation.allFramesPass,
    visualQuality: result.diagnostics.visualQuality.overall,
  });
  logStroMotionValidationReport(result.diagnostics.validation);
  logVisualQualityScorecard(
    result.diagnostics.visualQuality,
    result.diagnostics.maskQuality,
    result.diagnostics.ghostRacketValidation,
    result.diagnostics.timings,
    result.diagnostics.serveStress,
    result.diagnostics.exportParity,
  );
  if (result.ghostPoses.some((p) => p != null && p.length > 0)) {
    const { buildStrokeAnalytics } = await import('@/lib/stroMotionAnalytics');
    const analytics = buildStrokeAnalytics(result);
    console.log('[StroMotion] Stroke analytics ready:', {
      strokeId: analytics.strokeId,
      strokeFamily: analytics.diagnosticsSummary.strokeFamily,
      poseSuccessRate: analytics.diagnosticsSummary.poseSuccessRate,
      phaseCount: analytics.stroke.phases.length,
    });
  }
}

export interface StroMotionCompositeOptions {
  opacity?: number;
  fadeMode?: StroMotionOpacityMode;
  visibleCount?: number;
  dest: { x: number; y: number; w: number; h: number };
}

/** Draw base + ghosts oldest→newest so newest is on top (Dartfish hierarchy). */
export function renderStroMotionComposite(
  ctx: CanvasRenderingContext2D,
  result: StroMotionResult,
  options: StroMotionCompositeOptions,
): void {
  const {
    opacity = STRO_MOTION_DEFAULT_OPACITY,
    fadeMode = 'temporal',
    visibleCount = result.ghostLayers.length,
    dest,
  } = options;

  const layers = result.ghostLayers;
  const count = Math.min(visibleCount, layers.length);
  if (count <= 0) return;

  const total = layers.length;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  safeDrawImageBitmap(ctx, result.baseFrame, dest.x, dest.y, dest.w, dest.h);

  // Strict chronological order: index 0 = oldest drawn first, last = newest on top
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const ghostAlpha = isLast
      ? 1.0
      : fadeMode === 'temporal'
        ? temporalGhostOpacity(i, total)
        : opacity;

    ctx.save();
    ctx.globalAlpha = ghostAlpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'contrast(1.03) saturate(1.02)';
    safeDrawImageBitmap(ctx, layers[i], dest.x, dest.y, dest.w, dest.h);
    ctx.filter = 'none';
    ctx.restore();
  }

  ctx.restore();
}

function safeDrawImageBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  ...args: [number, number, number, number]
): boolean {
  try {
    ctx.drawImage(bitmap, ...args);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'InvalidStateError') {
      console.warn('[StroMotion] Skipped draw — bitmap was closed');
      return false;
    }
    throw err;
  }
}

export function clearStroMotionResult(result: StroMotionResult | null): void {
  if (!result) return;
  const { baseFrame, ghostLayers } = result;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try { baseFrame.close(); } catch { /* already closed */ }
      ghostLayers.forEach((layer) => {
        try { layer.close(); } catch { /* already closed */ }
      });
    });
  });
}

export function exportStroMotionPNG(canvas: HTMLCanvasElement, filename = 'stromotion.png'): void {
  try {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.error('[StroMotion] PNG export failed:', err);
    throw err;
  }
}

/** Export directly from result bitmaps when the live canvas is unavailable. */
export async function renderStroMotionResultToCanvas(
  result: StroMotionResult,
): Promise<HTMLCanvasElement> {
  const base = result.baseFrame;
  const w = base.width;
  const h = base.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  renderStroMotionComposite(ctx, result, {
    dest: { x: 0, y: 0, w, h },
  });
  return canvas;
}

export async function stroMotionResultToDataURL(result: StroMotionResult): Promise<string> {
  const canvas = await renderStroMotionResultToCanvas(result);
  return canvas.toDataURL('image/png');
}

export async function exportStroMotionPNGFromResult(
  result: StroMotionResult,
  filename = 'stromotion.png',
): Promise<void> {
  const canvas = await renderStroMotionResultToCanvas(result);
  exportStroMotionPNG(canvas, filename);
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
    finalHoldMs?: number;
    download?: boolean;
    filename?: string;
  },
): Promise<Blob | null> {
  const {
    frameCount,
    intervalMs = STRO_MOTION_ANIM_INTERVAL_MS,
    renderFrame,
    finalHoldMs = STRO_MOTION_VIDEO_FINAL_HOLD_MS,
    download = true,
    filename,
  } = options;
  if (frameCount <= 0) return null;

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
  await new Promise((resolve) => setTimeout(resolve, finalHoldMs));

  recorder.stop();
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const blob = new Blob(chunks, { type: mimeType });
  if (download) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `stromotion.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return blob;
}

/** Re-run AI mask proposal for a single frame (draft regenerate). */
export async function regenerateStroMotionFrameGhostLayer(
  video: HTMLVideoElement,
  params: {
    mode: StroMotionMode;
    startSec: number;
    sampleTimeSec: number;
    subjectBox: StroMotionSubjectBox;
    objectBox?: StroMotionSubjectBox;
  },
): Promise<ImageBitmap | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  prepareVideoForStroMotionExtraction(video);
  const wasPlaying = !video.paused;
  await waitForVideoPaused(video);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const offscreen = createExtractionSurface(vw, vh);
  const ctx = offscreen.getContext('2d') as CanvasCtx | null;
  if (!ctx) return null;

  const originalTime = video.currentTime;

  try {
    if (params.mode === 'object') {
      const box = normalizeObjectBox(params.objectBox ?? params.subjectBox);
      await captureVideoToSurface(video, params.sampleTimeSec, offscreen);
      return await buildObjectGhostLayer(offscreen, box, vw, vh);
    }

    const initialBox = normalizeSubjectBox(params.subjectBox);
    const { px, py, pw, ph } = subjectBoxPixels(initialBox, vw, vh);
    const motionUnion: PixelRect = { x0: px, y0: py, x1: px + pw, y1: py + ph };

    await captureVideoToSurface(video, params.startSec, offscreen);
    const baseImageData = ctx.getImageData(0, 0, vw, vh);

    await captureVideoToSurface(video, params.sampleTimeSec, offscreen);
    const currentImageData = ctx.getImageData(0, 0, vw, vh);

    const detector = await acquirePoseDetector();
    const pose = await detectPoseOnSurface(offscreen, detector);

    const { layer } = buildGhostLayerMask(
      currentImageData,
      baseImageData,
      pose,
      motionUnion,
      vw,
      vh,
    );

    return await imageDataToBitmap(layer);
  } finally {
    try {
      await seekVideoAndWait(video, originalTime);
    } catch {
      video.currentTime = originalTime;
    }
    if (wasPlaying) void video.play();
  }
}
