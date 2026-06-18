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

/** Which frame is used as the still background plate for the composite. */
export type StroMotionBackground = 'start' | 'end';

/** Order in which ghost masks accumulate in the video animation. */
export type StroMotionVideoOrder = 'forward' | 'reverse';

export const STRO_MOTION_FRAME_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type StroMotionFrameCount = (typeof STRO_MOTION_FRAME_COUNTS)[number];
export const STRO_MOTION_DEFAULT_FRAME_COUNT: StroMotionFrameCount = 5;
