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
  options?: { background?: StroMotionBackground; videoOrder?: StroMotionVideoOrder; endTimeSec?: number },
): Promise<string> {
  if (countExportReadyFrames(draft.frames) !== draft.frames.length) {
    throw new Error('All frames must be marked Ready before export.');
  }

  const hydrated = await hydrateDraftBitmapsForExport(video, draft);
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
  });

  return canvas.toDataURL('image/png');
}
