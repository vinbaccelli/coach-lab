'use client';

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureSource';
import { renderStroMotionDraftComposite } from '@/lib/stroMotionDraft/compositeFromDraft';
import { countExportReadyFrames, getCompositeMask } from '@/lib/stroMotionDraft/frameMask';
import type { StroMotionBackground, StroMotionDraft, StroMotionFrameDraft, StroMotionVideoOrder } from '@/lib/stroMotionDraft/types';

function closeBitmap(bitmap: ImageBitmap | null | undefined): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch { /* closed */ }
}

/**
 * A bitmap is usable for export when it is alive and exactly the video's size. A closed ImageBitmap reports
 * 0x0, so one comparison covers "closed" and "captured at another size" (the original reason for re-capturing:
 * a closed bitmap must not break Generate).
 */
function isUsableBitmap(b: ImageBitmap | null | undefined, w: number, h: number): b is ImageBitmap {
  return !!b && b.width === w && b.height === h;
}

/**
 * Make sure every bitmap the export reads is alive and native size, re-capturing ONLY the ones that are not.
 * Before M1 (docs/V1_FREEZE.md Stage 2) this re-captured the plate and every frame on every call, three times
 * per Generate, and never closed the replaced bitmaps (+27 bitmaps / +142 MiB live per Generate at 1080p x 5
 * frames, measured). Nothing to re-capture returns the SAME draft object, so callers can skip a state update.
 * `created` lists the bitmaps this call made, so a caller that does not hand them to the draft can close them.
 * The replaced (alive but wrong-size) bitmaps are still NOT closed here: the Canvas render loop may hold them
 * through stroMotionDraftRef and a close would throw on drawImage; closed ones need nothing.
 */
export async function hydrateDraftBitmaps(
  video: HTMLVideoElement,
  draft: StroMotionDraft,
  /** Injectable for tests; production uses the isolated capture source. */
  capture: (video: HTMLVideoElement, timeSec: number) => Promise<ImageBitmap> = captureVideoFrameAtTime,
): Promise<{ draft: StroMotionDraft; created: ImageBitmap[] }> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) return { draft, created: [] };

  const created: ImageBitmap[] = [];
  const grab = async (timeSec: number): Promise<ImageBitmap> => {
    const bitmap = await capture(video, timeSec);
    created.push(bitmap);
    return bitmap;
  };

  const backgroundPlate = isUsableBitmap(draft.backgroundPlate, w, h)
    ? draft.backgroundPlate
    : await grab(draft.backgroundTimeSec);
  let changed = backgroundPlate !== draft.backgroundPlate || draft.videoWidth !== w || draft.videoHeight !== h;

  const frames: StroMotionFrameDraft[] = [];
  for (const frame of draft.frames) {
    if (isUsableBitmap(frame.sourceFrame, w, h)) {
      frames.push(frame);
      continue;
    }
    let sourceFrame: ImageBitmap | null = frame.sourceFrame;
    try {
      sourceFrame = await grab(frame.timeSec);
      changed = true;
    } catch {
      sourceFrame = frame.sourceFrame;
    }
    frames.push({ ...frame, sourceFrame });
  }

  if (!changed) return { draft, created: [] };
  return { draft: { ...draft, backgroundPlate, frames, videoWidth: w, videoHeight: h }, created };
}

/** Same contract as before (returns the draft to export); now re-captures only what is not usable. */
export async function hydrateDraftBitmapsForExport(
  video: HTMLVideoElement,
  draft: StroMotionDraft,
): Promise<StroMotionDraft> {
  return (await hydrateDraftBitmaps(video, draft)).draft;
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

  // Bitmaps re-captured here belong to this export only (the draft is not updated): close them when done.
  const { draft: hydrated, created } = await hydrateDraftBitmaps(video, source);
  const w = hydrated.videoWidth;
  const h = hydrated.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  let endPlate: ImageBitmap | null = null;
  try {
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
  } finally {
    // Everything this call captured is local to it (not in any draft, not read by the render loop).
    for (const b of created) closeBitmap(b);
    closeBitmap(endPlate);
    canvas.width = 0;
    canvas.height = 0;
  }
}
