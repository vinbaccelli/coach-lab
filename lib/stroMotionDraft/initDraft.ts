'use client';

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureSource';
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

  /**
   * CARRY THE BATCH BODY-SCALE REFERENCE ACROSS A RESYNC.
   *
   * This function rebuilds the draft from scratch, so every field it forgets to
   * name is DROPPED — and `batchUnitFloorNorm` used to be one of them. That made
   * auto-racket silently degrade after any re-spacing: `syncDraft` re-fires on
   * every start/end/frame-count change, so nudging one frame marker erased the
   * reference, `poseScaleUnit` then re-derived `unit` from a single frame and
   * collapsed it (measured: batch 46px vs re-run 5px), and the wrist gate
   * (`unit * WRIST_GATE_UNITS`) shrank to ~15px — below the 34–119px at which
   * real detections sit, so every true racket was gated out. Same thin-selection
   * collapse hits the zone, the segmenter crop and the head oval.
   *
   * Keyed on SAME FOOTAGE only: the value is normalised (unit/videoWidth), so it
   * survives a background-time or objectType change untouched — the athlete does
   * not change size because the coach picked a different plate. A genuinely
   * different video gets null and the next batch measures its own.
   *
   * Deliberate resets stay deliberate: `clearAllSelections` nulls it so the next
   * batch recomputes from re-detected poses, and that null propagates here as a
   * null `previous` value rather than being overwritten.
   */
  const sameFootage =
    !!params.previous &&
    params.previous.videoWidth === vw &&
    params.previous.videoHeight === vh;
  const batchUnitFloorNorm = sameFootage
    ? params.previous!.batchUnitFloorNorm ?? null
    : null;

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
    batchUnitFloorNorm,
  };
}
