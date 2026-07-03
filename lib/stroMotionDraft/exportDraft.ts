'use client';

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureFrame';
import { renderStroMotionDraftComposite } from '@/lib/stroMotionDraft/compositeFromDraft';
import { countExportReadyFrames, getCompositeMask } from '@/lib/stroMotionDraft/frameMask';
import type { StroMotionBackground, StroMotionDraft, StroMotionFrameDraft, StroMotionVideoOrder } from '@/lib/stroMotionDraft/types';

function closeBitmap(bitmap: ImageBitmap | null | undefined): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch { /* closed */ }
}

/** Re-capture video frames before export so closed ImageBitmaps cannot break Generate. */
export async function hydrateDraftBitmapsForExport(
  video: HTMLVideoElement,
  draft: StroMotionDraft,
): Promise<StroMotionDraft> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return draft;

  const backgroundPlate = await captureVideoFrameAtTime(video, draft.backgroundTimeSec);
  const frames: StroMotionFrameDraft[] = [];

  for (const frame of draft.frames) {
    let sourceFrame = frame.sourceFrame;
    try {
      sourceFrame = await captureVideoFrameAtTime(video, frame.timeSec);
    } catch {
      sourceFrame = frame.sourceFrame;
    }
    frames.push({ ...frame, sourceFrame });
  }

  // Do NOT close old bitmaps here — the Canvas render loop may still hold references
  // to them via stroMotionDraftRef.current. Closing eagerly causes InvalidStateError
  // on drawImage. Let GC handle the old ones after React commits the new draft.

  return {
    ...draft,
    backgroundPlate,
    frames,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  };
}

export async function exportStroMotionDraftPng(
  video: HTMLVideoElement,
  draft: StroMotionDraft,
  options?: {
    background?: StroMotionBackground;
    videoOrder?: StroMotionVideoOrder;
    endTimeSec?: number;
    /** Uniform ghost transparency (0–1). Undefined keeps the default temporal fade. */
    opacity?: number;
    /** Restrict the render to these frame indices (Generate "included renders"). */
    includedIndices?: number[];
  },
): Promise<string> {
  const source = options?.includedIndices
    ? { ...draft, frames: draft.frames.filter((f) => options.includedIndices!.includes(f.index)) }
    : draft;
  if (source.frames.length === 0) throw new Error('Include at least one frame.');
  if (countExportReadyFrames(source.frames) !== source.frames.length) {
    throw new Error('All frames must be marked Ready before export.');
  }

  const hydrated = await hydrateDraftBitmapsForExport(video, source);
  const w = hydrated.videoWidth;
  const h = hydrated.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  let endPlate: ImageBitmap | null = null;
  if (options?.background === 'end' && options.endTimeSec !== undefined) {
    try { endPlate = await captureVideoFrameAtTime(video, options.endTimeSec); } catch { /* fallback to start */ }
  }

  renderStroMotionDraftComposite(ctx, hydrated, {
    dest: { x: 0, y: 0, w, h },
    previewMode: false,
    resolveMask: getCompositeMask,
    background: options?.background ?? 'start',
    videoOrder: options?.videoOrder ?? 'forward',
    endPlate,
    ...(options?.opacity !== undefined ? { fadeMode: 'uniform' as const, opacity: options.opacity } : {}),
  });

  return canvas.toDataURL('image/png');
}
