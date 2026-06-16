'use client';

import type { AlphaMask, StroMotionFrameDraft, StroMotionFrameStatus } from '@/lib/stroMotionDraft/types';

export function createEmptyMask(width: number, height: number): AlphaMask {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height),
  };
}

export function maskHasContent(mask: AlphaMask | null | undefined): boolean {
  if (!mask?.data?.length) return false;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] > 0) return true;
  }
  return false;
}

/** Mask for live canvas preview — any coach-reviewed or AI-proposed mask. */
export function getPreviewMask(frame: StroMotionFrameDraft): AlphaMask | null {
  if (frame.readyMask && maskHasContent(frame.readyMask)) return frame.readyMask;
  if (frame.working && maskHasContent(frame.working)) return frame.working;
  if (frame.aiSnapshot && maskHasContent(frame.aiSnapshot)) return frame.aiSnapshot;
  return null;
}

/** Mask used for composite export — ready frames with visible alpha only. */
export function getExportMask(frame: StroMotionFrameDraft): AlphaMask | null {
  if (frame.status !== 'ready') return null;
  for (const candidate of [frame.readyMask, frame.working, frame.aiSnapshot]) {
    if (candidate && maskHasContent(candidate)) return candidate;
  }
  return null;
}

export function frameHasMask(frame: StroMotionFrameDraft): boolean {
  return maskHasContent(frame.readyMask)
    || maskHasContent(frame.working)
    || maskHasContent(frame.aiSnapshot);
}

export function countFramesWithPreviewMask(frames: StroMotionFrameDraft[]): number {
  return frames.filter((f) => !!getPreviewMask(f)).length;
}

export function allFramesReady(frames: StroMotionFrameDraft[]): boolean {
  return frames.length > 0 && frames.every((f) => f.status === 'ready' && frameHasMask(f));
}

export function countReadyFrames(frames: StroMotionFrameDraft[]): number {
  return frames.filter((f) => f.status === 'ready').length;
}

/** Frames marked ready with non-empty mask content (required for Generate). */
export function countExportReadyFrames(frames: StroMotionFrameDraft[]): number {
  return frames.filter((f) => f.status === 'ready' && frameHasMask(f)).length;
}

export function statusAfterMaskEdit(prev: StroMotionFrameStatus): StroMotionFrameStatus {
  return prev === 'ready' ? 'edited' : 'edited';
}

export function defaultFrameLabel(index: number): string {
  return `Frame ${index + 1}`;
}

/** Best mask available for export — ready mask preferred, then working / AI. */
export function getCompositeMask(frame: StroMotionFrameDraft): AlphaMask | null {
  for (const candidate of [frame.readyMask, frame.working, frame.aiSnapshot]) {
    if (candidate && maskHasContent(candidate)) return candidate;
  }
  return null;
}
