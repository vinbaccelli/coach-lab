'use client';

import {
  STRO_MOTION_DEFAULT_OPACITY,
  temporalGhostOpacity,
  type StroMotionOpacityMode,
} from '@/lib/stroMotion';
import { getExportMask, getPreviewMask } from '@/lib/stroMotionDraft/frameMask';
import type { AlphaMask, StroMotionDraft, StroMotionFrameDraft } from '@/lib/stroMotionDraft/types';

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
  const mw = mask.width;
  const mh = mask.height;
  if (sw !== mw || sh !== mh) {
    console.warn('[StroMotion] Mask/source size mismatch', { sw, sh, mw, mh });
    return;
  }

  const w = mw;
  const h = mh;
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  sctx.drawImage(source, 0, 0, w, h);
  const imageData = sctx.getImageData(0, 0, w, h);
  const px = imageData.data;
  for (let i = 0; i < w * h; i++) {
    const a = mask.data[i];
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
  /** When true, include edited / AI-proposed masks before Mark Ready. */
  previewMode?: boolean;
  dest: { x: number; y: number; w: number; h: number };
  /** Override mask resolution (export uses composite-ready masks). */
  resolveMask?: (frame: StroMotionFrameDraft) => AlphaMask | null;
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
    previewMode = false,
    dest,
    resolveMask,
  } = options;

  const pickMask = resolveMask
    ?? ((frame: StroMotionFrameDraft) => (previewMode ? getPreviewMask(frame) : getExportMask(frame)));

  const count = Math.min(visibleCount, draft.frames.length);
  if (count <= 0) return;
  const total = draft.frames.length;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(draft.backgroundPlate, dest.x, dest.y, dest.w, dest.h);

  const scratch = document.createElement('canvas');
  for (let i = 0; i < count; i++) {
    const frame = draft.frames[i];
    const mask = pickMask(frame);
    if (!frame.sourceFrame || !mask) continue;

    const isLast = i === count - 1;
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
