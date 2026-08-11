'use client';

import type { StroMotionSubjectBox } from '@/lib/stroMotion';

export type StroMotionObjectType = 'racket' | 'player' | 'ball' | 'custom';

export type StroMotionFrameStatus = 'pending' | 'edited' | 'ready';

export interface AlphaMask {
  width: number;
  height: number;
  /** Single-channel alpha 0..255, length = width * height */
  data: Uint8ClampedArray;
}

export interface StroMotionFrameDraft {
  index: number;
  timeSec: number;
  /** Optional coach label (Frame 1, Preparation, etc.) */
  label: string;
  status: StroMotionFrameStatus;
  /** Normalized selection box for this frame */
  selectionBox: StroMotionSubjectBox | null;
  /** Captured video frame at timeSec — set after Select Area */
  sourceFrame: ImageBitmap | null;
  /** AI-proposed mask */
  aiSnapshot: AlphaMask | null;
  /** Coach working mask (brush edits) */
  working: AlphaMask | null;
  /** Mask used for export when status is ready */
  readyMask: AlphaMask | null;
}

export interface StroMotionDraft {
  schemaVersion: '1.1-coach-override';
  objectType: StroMotionObjectType;
  backgroundTimeSec: number;
  backgroundPlate: ImageBitmap;
  frames: StroMotionFrameDraft[];
  sampleTimes: number[];
  videoWidth: number;
  videoHeight: number;
  /**
   * BATCH BODY-SCALE REFERENCE as `unit / width` (`batchScaleUnitNorm`), stored so
   * the SINGLE-FRAME paths can reuse the batch's stabilized answer.
   *
   * WHY IT HAS TO LIVE HERE. Only the auto-process pass can COMPUTE this — it is a
   * median across every frame's pose, and one frame has no way to know the athlete
   * did not really shrink. But the frame editor's "Redo mask" re-runs the SAME
   * pipeline for ONE frame, and without this it re-derived a raw per-frame `unit`
   * that collapses when the shoulder AND hip lines both foreshorten. `poseScaleUnit`
   * prefers hip width as its sanity reference and never consults the pose bbox while
   * hips are visible, so a frame where both collapse yields a tiny unit that every
   * intra-frame cross-check endorses (measured: batch 46px vs re-run 5px on the same
   * frame). The zone, the segmenter crop and the head oval all scale from `unit`, so
   * that re-run built them ~10x too small — the "terrible super thin selection".
   *
   * On the draft rather than a module ref because it belongs to THESE frames:
   * clearing or replacing the draft must drop it, and a stale reference from another
   * video would be worse than none.
   *
   * Optional: a draft whose frames were selected manually, with no auto-process pass,
   * has no batch to take a median from and keeps the previous per-frame behaviour.
   */
  batchUnitFloorNorm?: number | null;
}

export type BrushMode = 'add' | 'remove' | 'flood-remove';

/** Which frame is used as the still background plate for the composite. */
export type StroMotionBackground = 'start' | 'end';

/** Order in which ghost masks accumulate in the video animation. */
export type StroMotionVideoOrder = 'forward' | 'reverse';

export const STRO_MOTION_FRAME_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type StroMotionFrameCount = (typeof STRO_MOTION_FRAME_COUNTS)[number];
export const STRO_MOTION_DEFAULT_FRAME_COUNT: StroMotionFrameCount = 5;
