'use client';

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureFrame';
import { defaultFrameLabel } from '@/lib/stroMotionDraft/frameMask';
import type {
  StroMotionDraft,
  StroMotionFrameDraft,
  StroMotionObjectType,
} from '@/lib/stroMotionDraft/types';

export interface EnsureDraftParams {
  objectType: StroMotionObjectType;
  backgroundTimeSec: number;
  sampleTimes: number[];
  /** Preserve labels/masks for frames that still exist when resizing */
  previous?: StroMotionDraft | null;
}

function emptyFrame(index: number, timeSec: number, label?: string): StroMotionFrameDraft {
  return {
    index,
    timeSec,
    label: label ?? defaultFrameLabel(index),
    status: 'pending',
    selectionBox: null,
    sourceFrame: null,
    aiSnapshot: null,
    working: null,
    readyMask: null,
  };
}

export async function ensureStroMotionDraft(
  video: HTMLVideoElement,
  params: EnsureDraftParams,
): Promise<StroMotionDraft | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;
  if (params.sampleTimes.length === 0) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const backgroundUnchanged =
    params.previous &&
    Math.abs(params.previous.backgroundTimeSec - params.backgroundTimeSec) < 0.001 &&
    params.previous.videoWidth === vw &&
    params.previous.videoHeight === vh;

  const backgroundPlate = backgroundUnchanged
    ? params.previous!.backgroundPlate
    : await captureVideoFrameAtTime(video, params.backgroundTimeSec);

  const prevByIndex = new Map(
    (params.previous?.frames ?? []).map((f) => [f.index, f]),
  );

  const objectTypeUnchanged =
    !params.previous || params.previous.objectType === params.objectType;
  const preserveFrameMasks = backgroundUnchanged && objectTypeUnchanged;

  const frames: StroMotionFrameDraft[] = params.sampleTimes.map((timeSec, index) => {
    const prev = prevByIndex.get(index);
    if (
      preserveFrameMasks &&
      prev &&
      Math.abs(prev.timeSec - timeSec) < 0.001 &&
      prev.sourceFrame &&
      (prev.aiSnapshot || prev.working || prev.readyMask)
    ) {
      return { ...prev, index, timeSec };
    }
    return emptyFrame(index, timeSec, prev?.label);
  });

  return {
    schemaVersion: '1.1-coach-override',
    objectType: params.objectType,
    backgroundTimeSec: params.backgroundTimeSec,
    backgroundPlate,
    frames,
    sampleTimes: [...params.sampleTimes],
    videoWidth: vw,
    videoHeight: vh,
  };
}
