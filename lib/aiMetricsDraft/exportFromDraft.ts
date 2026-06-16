'use client';

import type { BiomechanicsAnalysis, PhaseMarker } from '@/lib/biomechanics/types';
import { getExportMeasurements } from '@/lib/aiMetricsDraft/measurementValues';
import type { AIMetricsDraft } from '@/lib/aiMetricsDraft/types';

export function buildPhaseMarkersFromDraft(draft: AIMetricsDraft): PhaseMarker[] {
  return draft.frames.map((f) => ({
    id: `frame-${f.index}`,
    label: f.label,
    short: String(f.index + 1),
    timeSec: f.timeSec,
  }));
}

/** Export analysis using ready measurements only. */
export function buildAnalysisFromDraft(draft: AIMetricsDraft): BiomechanicsAnalysis | null {
  const measurements = draft.frames
    .map(getExportMeasurements)
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (measurements.length !== draft.frames.length) return null;

  return {
    strokeType: draft.strokeType,
    trimStartSec: draft.trimStartSec,
    trimEndSec: draft.trimEndSec,
    phases: buildPhaseMarkersFromDraft(draft),
    measurements,
    ...(draft.strokeType === 'custom' && draft.customSteps?.length
      ? { customSteps: draft.customSteps }
      : {}),
    fps: 30,
  };
}
