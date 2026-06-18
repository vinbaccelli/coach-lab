'use client';

import type {
  PhaseDefinition,
  PhaseMeasurements,
  PoseKeypoint,
  PoseSample,
  StrokeType,
} from '@/lib/biomechanics/types';

export type { PoseKeypoint };
import {
  STRO_MOTION_DEFAULT_FRAME_COUNT,
  STRO_MOTION_FRAME_COUNTS,
  type StroMotionFrameCount,
} from '@/lib/stroMotionDraft/types';

export type AIMetricsFrameStatus = 'pending' | 'edited' | 'ready';

export type AIMetricsModuleId =
  | 'jointAngles'
  | 'shoulderHipSeparation'
  | 'footDirection'
  | 'footSpacing'
  | 'racketAngle'
  | 'stringbedDirection';

export const AIMETRICS_MODULE_LABELS: Record<AIMetricsModuleId, string> = {
  jointAngles: 'Joint Angles',
  shoulderHipSeparation: 'Shoulder / Hip Separation',
  footDirection: 'Foot Direction',
  footSpacing: 'Foot Spacing',
  racketAngle: 'Racket Angle',
  stringbedDirection: 'Stringbed Direction',
};

export const DEFAULT_ENABLED_MODULES: Record<AIMetricsModuleId, boolean> = {
  jointAngles: true,
  shoulderHipSeparation: true,
  footDirection: true,
  footSpacing: true,
  racketAngle: true,
  stringbedDirection: true,
};

export interface AIMetricsFrameDraft {
  index: number;
  timeSec: number;
  label: string;
  status: AIMetricsFrameStatus;
  poseSample: PoseSample | null;
  /** AI-proposed measurements (draft only) */
  ai: PhaseMeasurements | null;
  /** Coach working copy — editable */
  coach: PhaseMeasurements | null;
  /** Snapshot used for export when status is ready */
  ready: PhaseMeasurements | null;
  /** Which measurement modules are enabled for this specific frame */
  enabledModules: Record<AIMetricsModuleId, boolean>;
  /**
   * Skeleton pose snapshot stamped onto this frame — drawn as a permanent
   * overlay in the exported card (not a live overlay).
   */
  skeletonStamp: PoseSample | null;
  /** Serialised Fabric.js canvas state for per-frame coach drawings */
  coachDrawingJson: string | null;
}

export interface AIMetricsDraft {
  schemaVersion: '1.1-coach-override';
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  customSteps?: PhaseDefinition[];
  enabledModules: Record<AIMetricsModuleId, boolean>;
  frames: AIMetricsFrameDraft[];
  sampleTimes: number[];
}

export {
  STRO_MOTION_FRAME_COUNTS as AIMETRICS_FRAME_COUNTS,
  STRO_MOTION_DEFAULT_FRAME_COUNT as AIMETRICS_DEFAULT_FRAME_COUNT,
};
export type { StroMotionFrameCount as AIMetricsFrameCount };
