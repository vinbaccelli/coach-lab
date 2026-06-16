'use client';

import { computePhaseMeasurements } from '@/lib/biomechanics/measurements';
import { samplePosesAtTimes } from '@/lib/biomechanics/poseSampling';
import { clonePhaseMeasurements } from '@/lib/aiMetricsDraft/measurementValues';
import type { PhaseMeasurements, PoseSample } from '@/lib/biomechanics/types';

export interface ProposeFrameMeasurementsResult {
  poseSample: PoseSample;
  ai: PhaseMeasurements;
  coach: PhaseMeasurements;
}

export async function proposeFrameMeasurements(
  video: HTMLVideoElement,
  frameId: string,
  frameLabel: string,
  timeSec: number,
): Promise<ProposeFrameMeasurementsResult | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const samples = await samplePosesAtTimes(video, [timeSec]);
  const poseSample = samples[0];
  if (!poseSample) return null;

  const ai = computePhaseMeasurements(
    frameId,
    frameLabel,
    timeSec,
    poseSample.keypoints,
  );
  const coach = clonePhaseMeasurements(ai);

  return { poseSample, ai, coach };
}
