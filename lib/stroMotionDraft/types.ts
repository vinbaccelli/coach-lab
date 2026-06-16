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
}

export type BrushMode = 'add' | 'remove' | 'flood-remove';

/** V1 frame counts (product freeze: typically 4–7). */
export const STRO_MOTION_FRAME_COUNTS = [4, 5, 6, 7] as const;
export type StroMotionFrameCount = (typeof STRO_MOTION_FRAME_COUNTS)[number];
export const STRO_MOTION_DEFAULT_FRAME_COUNT: StroMotionFrameCount = 5;
