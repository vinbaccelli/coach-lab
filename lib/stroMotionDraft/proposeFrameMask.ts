'use client';

import { buildMatteAlphaMask } from '@/lib/objectMultiplier';
import { normalizeObjectBox, type StroMotionSubjectBox } from '@/lib/stroMotion';
import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureFrame';
import { maskHasContent } from '@/lib/stroMotionDraft/frameMask';
import { cloneAlphaMask, embedRegionMask, fillBoxMask } from '@/lib/stroMotionDraft/maskUtils';
import type { AlphaMask, StroMotionObjectType } from '@/lib/stroMotionDraft/types';

export interface ProposeFrameMaskResult {
  sourceFrame: ImageBitmap;
  aiSnapshot: AlphaMask;
  working: AlphaMask;
}

function boxToPixels(
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
  padFraction = 0.12,
) {
  const px = Math.round(box.x * vw);
  const py = Math.round(box.y * vh);
  const pw = Math.max(1, Math.round(box.width * vw));
  const ph = Math.max(1, Math.round(box.height * vh));
  const padX = Math.round(pw * padFraction);
  const padY = Math.round(ph * padFraction);
  const x0 = Math.max(0, px - padX);
  const y0 = Math.max(0, py - padY);
  const x1 = Math.min(vw, px + pw + padX);
  const y1 = Math.min(vh, py + ph + padY);
  return {
    px: x0,
    py: y0,
    pw: Math.max(1, x1 - x0),
    ph: Math.max(1, y1 - y0),
  };
}

async function matteMaskInSelection(
  sourceFrame: ImageBitmap,
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
): Promise<AlphaMask> {
  const { px, py, pw, ph } = boxToPixels(box, vw, vh);
  const crop = await createImageBitmap(sourceFrame, px, py, pw, ph);
  try {
    const regionMatte = await buildMatteAlphaMask(crop);
    return embedRegionMask(vw, vh, px, py, regionMatte);
  } finally {
    crop.close();
  }
}

/**
 * Fast background-removal proposal after coach Select Area.
 * Uses border flood-fill matting with a selection-box fallback so the editor always opens.
 */
export async function proposeFrameMask(
  video: HTMLVideoElement,
  timeSec: number,
  selectionBox: StroMotionSubjectBox,
  _backgroundTimeSec: number,
  objectType: StroMotionObjectType = 'racket',
): Promise<ProposeFrameMaskResult | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const box = normalizeObjectBox(selectionBox);
  const sourceFrame = await captureVideoFrameAtTime(video, timeSec);

  // Always constrain to the selection box for precision regardless of object type.
  // Full-frame matting for 'player' produced too much bleed outside the drawn box.
  let aiSnapshot = await matteMaskInSelection(sourceFrame, box, vw, vh);

  if (!maskHasContent(aiSnapshot)) {
    aiSnapshot = fillBoxMask(vw, vh, box);
  }

  return {
    sourceFrame,
    aiSnapshot,
    working: cloneAlphaMask(aiSnapshot),
  };
}
