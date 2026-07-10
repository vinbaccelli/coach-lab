'use client';

import {
  STRO_MOTION_DEFAULT_OPACITY,
  temporalGhostOpacity,
  type StroMotionOpacityMode,
} from '@/lib/stroMotion';
import { getExportMask, getPreviewMask } from '@/lib/stroMotionDraft/frameMask';
import type { AlphaMask, StroMotionBackground, StroMotionDraft, StroMotionFrameDraft, StroMotionVideoOrder } from '@/lib/stroMotionDraft/types';

function renderMaskedFrame(
  ctx: CanvasRenderingContext2D,
  source: ImageBitmap,
  mask: AlphaMask,
  dest: { x: number; y: number; w: number; h: number },
  globalAlpha: number,
  scratch: HTMLCanvasElement,
): void {
  const sw = source.width;
  const sh = source.height;
  let mw = mask.width;
  let mh = mask.height;

  // If mask dimensions don't match source, rescale mask data to match source
  let effectiveMask = mask;
  if (sw !== mw || sh !== mh) {
    const rescaleCanvas = document.createElement('canvas');
    rescaleCanvas.width = sw;
    rescaleCanvas.height = sh;
    const rctx = rescaleCanvas.getContext('2d');
    if (!rctx) return;
    // Draw mask as greyscale RGBA onto a temporary canvas at source dimensions
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mw;
    maskCanvas.height = mh;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return;
    const maskImageData = mctx.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      const v = mask.data[i];
      maskImageData.data[i * 4] = v;
      maskImageData.data[i * 4 + 1] = v;
      maskImageData.data[i * 4 + 2] = v;
      maskImageData.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(maskImageData, 0, 0);
    // Nearest-neighbour rescale: bilinear smoothing feathered the mask edge,
    // which shifted the racket cut-out boundary off the actual racket ("frame
    // layer position not precise"). Keep the alpha edge crisp and aligned.
    rctx.imageSmoothingEnabled = false;
    rctx.drawImage(maskCanvas, 0, 0, sw, sh);
    const rescaled = rctx.getImageData(0, 0, sw, sh);
    const data = new Uint8ClampedArray(sw * sh);
    for (let i = 0; i < sw * sh; i++) data[i] = rescaled.data[i * 4];
    effectiveMask = { width: sw, height: sh, data };
    mw = sw;
    mh = sh;
  }

  const w = mw;
  const h = mh;
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  try { sctx.drawImage(source, 0, 0, w, h); } catch { return; }
  const imageData = sctx.getImageData(0, 0, w, h);
  const px = imageData.data;
  for (let i = 0; i < w * h; i++) {
    const a = effectiveMask.data[i];
    px[i * 4 + 3] = Math.round((px[i * 4 + 3] * a) / 255);
  }
  sctx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.globalAlpha = globalAlpha;
  ctx.filter = 'contrast(1.03) saturate(1.02)';
  ctx.drawImage(scratch, dest.x, dest.y, dest.w, dest.h);
  ctx.filter = 'none';
  ctx.restore();
}

export interface StroMotionDraftCompositeOptions {
  opacity?: number;
  fadeMode?: StroMotionOpacityMode;
  visibleCount?: number;
  /** First visible frame index (for 'vanish' layer mode — hides passed ghosts). */
  visibleStart?: number;
  /** When true, include edited / AI-proposed masks before Mark Ready. */
  previewMode?: boolean;
  dest: { x: number; y: number; w: number; h: number };
  /** Override mask resolution (export uses composite-ready masks). */
  resolveMask?: (frame: StroMotionFrameDraft) => AlphaMask | null;
  /** Which captured frame to use as the background plate. Default: 'start'. */
  background?: StroMotionBackground;
  /** Accumulation order for video animation. Default: 'forward'. */
  videoOrder?: StroMotionVideoOrder;
  /** End-frame bitmap — required when background === 'end'. */
  endPlate?: ImageBitmap | null;
  /**
   * When true, skip drawing the background plate — ghost masks are composited
   * directly over whatever is already on ctx (e.g. the live video frame).
   */
  overlayMode?: boolean;
}

export function renderStroMotionDraftComposite(
  ctx: CanvasRenderingContext2D,
  draft: StroMotionDraft,
  options: StroMotionDraftCompositeOptions,
): void {
  const {
    opacity = STRO_MOTION_DEFAULT_OPACITY,
    fadeMode = 'temporal',
    visibleCount = draft.frames.length,
    visibleStart = 0,
    previewMode = false,
    dest,
    resolveMask,
    background = 'start',
    videoOrder = 'forward',
    endPlate = null,
    overlayMode = false,
  } = options;

  const pickMask = resolveMask
    ?? ((frame: StroMotionFrameDraft) => (previewMode ? getPreviewMask(frame) : getExportMask(frame)));

  const allFrames = draft.frames;
  const count = Math.min(visibleCount, allFrames.length);
  if (count <= 0) return;
  const total = allFrames.length;

  // For reverse order: frame[n-1] is "current position", earlier frames are ghosts waiting ahead.
  // We paint in reverse — oldest/furthest frames first (bottom), newest on top.
  const orderedFrames = videoOrder === 'reverse' ? [...allFrames].reverse() : allFrames;

  ctx.save();
  ctx.globalAlpha = 1;

  if (!overlayMode) {
    const bgPlate = background === 'end' && endPlate ? endPlate : draft.backgroundPlate;
    try { ctx.drawImage(bgPlate, dest.x, dest.y, dest.w, dest.h); } catch { ctx.restore(); return; }
  }

  const scratch = document.createElement('canvas');
  const startIdx = Math.max(0, Math.min(visibleStart, count));
  for (let i = startIdx; i < count; i++) {
    const frame = orderedFrames[i];
    const mask = pickMask(frame);
    if (!frame.sourceFrame || !mask) continue;

    const isLast = i === count - 1;
    // In reverse mode, the "current" frame (last painted) is the earliest time
    const ghostAlpha = isLast
      ? 1.0
      : fadeMode === 'temporal'
        ? temporalGhostOpacity(i, total)
        : opacity;

    renderMaskedFrame(ctx, frame.sourceFrame, mask, dest, ghostAlpha, scratch);
  }

  ctx.restore();
}

export async function stroMotionDraftToCanvas(
  draft: StroMotionDraft,
  options?: { previewMode?: boolean },
): Promise<HTMLCanvasElement> {
  const w = draft.videoWidth;
  const h = draft.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  renderStroMotionDraftComposite(ctx, draft, {
    dest: { x: 0, y: 0, w, h },
    previewMode: options?.previewMode,
  });
  return canvas;
}

export async function stroMotionDraftToDataURL(
  draft: StroMotionDraft,
  options?: { previewMode?: boolean },
): Promise<string> {
  const canvas = await stroMotionDraftToCanvas(draft, options);
  return canvas.toDataURL('image/png');
}
