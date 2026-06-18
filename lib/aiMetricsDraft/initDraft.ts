'use client';

import type { PhaseDefinition, StrokeType } from '@/lib/biomechanics/types';
import { defaultFrameLabel } from '@/lib/aiMetricsDraft/measurementValues';
import {
  DEFAULT_ENABLED_MODULES,
  type AIMetricsDraft,
  type AIMetricsFrameDraft,
} from '@/lib/aiMetricsDraft/types';

export interface EnsureAIMetricsDraftParams {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  sampleTimes: number[];
  customSteps?: PhaseDefinition[];
  previous?: AIMetricsDraft | null;
}

function emptyFrame(
  index: number,
  timeSec: number,
  label?: string,
  enabledModules?: Record<string, boolean>,
): AIMetricsFrameDraft {
  return {
    index,
    timeSec,
    label: label ?? defaultFrameLabel(index),
    status: 'pending',
    poseSample: null,
    ai: null,
    coach: null,
    ready: null,
    enabledModules: (enabledModules as Record<import('@/lib/aiMetricsDraft/types').AIMetricsModuleId, boolean>) ?? { ...DEFAULT_ENABLED_MODULES },
    skeletonStamp: null,
    coachDrawingJson: null,
  };
}

function labelForIndex(
  index: number,
  strokeType: StrokeType,
  customSteps?: PhaseDefinition[],
): string {
  if (strokeType === 'custom' && customSteps?.[index]) {
    return customSteps[index].label;
  }
  const prev = customSteps?.[index];
  return prev?.label ?? defaultFrameLabel(index);
}

export function ensureAIMetricsDraft(params: EnsureAIMetricsDraftParams): AIMetricsDraft {
  if (params.sampleTimes.length === 0) {
    throw new Error('AIMetrics draft requires at least one sample time');
  }

  const prevByIndex = new Map(
    (params.previous?.frames ?? []).map((f) => [f.index, f]),
  );

  const frames: AIMetricsFrameDraft[] = params.sampleTimes.map((timeSec, index) => {
    const prev = prevByIndex.get(index);
    const label = labelForIndex(index, params.strokeType, params.customSteps);
    if (
      prev &&
      Math.abs(prev.timeSec - timeSec) < 0.001 &&
      prev.ai &&
      prev.poseSample
    ) {
      return {
        ...prev,
        index,
        timeSec,
        label,
        enabledModules: prev.enabledModules ?? { ...DEFAULT_ENABLED_MODULES },
        skeletonStamp: prev.skeletonStamp ?? null,
        coachDrawingJson: prev.coachDrawingJson ?? null,
      };
    }
    return emptyFrame(index, timeSec, label, params.previous?.enabledModules);
  });

  return {
    schemaVersion: '1.1-coach-override',
    strokeType: params.strokeType,
    trimStartSec: params.trimStartSec,
    trimEndSec: params.trimEndSec,
    customSteps: params.strokeType === 'custom' ? params.customSteps : undefined,
    enabledModules: params.previous?.enabledModules ?? { ...DEFAULT_ENABLED_MODULES },
    frames,
    sampleTimes: [...params.sampleTimes],
  };
}
