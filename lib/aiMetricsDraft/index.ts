'use client';

export { buildAnalysisFromDraft, buildPhaseMarkersFromDraft } from '@/lib/aiMetricsDraft/exportFromDraft';
export { ensureAIMetricsDraft } from '@/lib/aiMetricsDraft/initDraft';
export {
  allFramesReady,
  clonePhaseMeasurements,
  countReadyFrames,
  defaultFrameLabel,
  frameHasMeasurements,
  getExportMeasurements,
  getWorkingMeasurements,
} from '@/lib/aiMetricsDraft/measurementValues';
export { proposeFrameMeasurements } from '@/lib/aiMetricsDraft/proposeFrameMeasurements';
export type {
  AIMetricsDraft,
  AIMetricsFrameDraft,
  AIMetricsFrameStatus,
  AIMetricsFrameCount,
  AIMetricsModuleId,
} from '@/lib/aiMetricsDraft/types';
export {
  AIMETRICS_DEFAULT_FRAME_COUNT,
  AIMETRICS_FRAME_COUNTS,
  AIMETRICS_MODULE_LABELS,
  DEFAULT_ENABLED_MODULES,
} from '@/lib/aiMetricsDraft/types';
