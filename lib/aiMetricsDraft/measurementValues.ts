'use client';

import type { PhaseMeasurements } from '@/lib/biomechanics/types';
import type { AIMetricsFrameDraft } from '@/lib/aiMetricsDraft/types';

export function clonePhaseMeasurements(m: PhaseMeasurements): PhaseMeasurements {
  return {
    ...m,
    jointAngles: { ...m.jointAngles },
    footDirection: { ...m.footDirection },
    footSpacing: m.footSpacing ? { ...m.footSpacing } : null,
    balance: { ...m.balance },
    stringbedDirection: { ...m.stringbedDirection },
  };
}

export function getWorkingMeasurements(frame: AIMetricsFrameDraft): PhaseMeasurements | null {
  return frame.coach ?? frame.ai;
}

export function getExportMeasurements(frame: AIMetricsFrameDraft): PhaseMeasurements | null {
  if (frame.status !== 'ready') return null;
  return frame.ready ?? frame.coach ?? frame.ai;
}

export function frameHasMeasurements(frame: AIMetricsFrameDraft): boolean {
  return !!(frame.ai || frame.coach || frame.ready);
}

export function allFramesReady(frames: AIMetricsFrameDraft[]): boolean {
  return frames.length > 0 && frames.every((f) => f.status === 'ready' && frameHasMeasurements(f));
}

export function countReadyFrames(frames: AIMetricsFrameDraft[]): number {
  return frames.filter((f) => f.status === 'ready').length;
}

export function defaultFrameLabel(index: number): string {
  return `Frame ${index + 1}`;
}
