import { computePhaseMeasurements } from '@/lib/biomechanics/measurements';
import { proposePhaseMarkers } from '@/lib/biomechanics/phaseDetection';
import { nearestPoseSample } from '@/lib/biomechanics/poseSampling';
import type {
  BiomechanicsAnalysis,
  PhaseDefinition,
  PhaseMarker,
  PhaseMeasurements,
  PoseSample,
  StrokeType,
} from '@/lib/biomechanics/types';

export function buildMeasurementsForPhases(
  phases: PhaseMarker[],
  poseSamples: PoseSample[],
): PhaseMeasurements[] {
  return phases.map((phase) => {
    const keypoints = nearestPoseSample(poseSamples, phase.timeSec);
    return computePhaseMeasurements(
      phase.id,
      phase.label,
      phase.timeSec,
      keypoints,
    );
  });
}

export function buildBiomechanicsAnalysis(input: {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  phases: PhaseMarker[];
  poseSamples: PoseSample[];
  customSteps?: PhaseDefinition[];
  fps?: number;
}): BiomechanicsAnalysis {
  return {
    strokeType: input.strokeType,
    trimStartSec: input.trimStartSec,
    trimEndSec: input.trimEndSec,
    phases: input.phases,
    measurements: buildMeasurementsForPhases(input.phases, input.poseSamples),
    ...(input.strokeType === 'custom' && input.customSteps?.length
      ? { customSteps: input.customSteps }
      : {}),
    fps: input.fps ?? 30,
  };
}

export function detectAndMeasure(input: {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  poseSamples: PoseSample[];
  customSteps?: PhaseDefinition[];
  fps?: number;
}): BiomechanicsAnalysis {
  const phases = proposePhaseMarkers(
    input.strokeType,
    input.poseSamples,
    input.trimStartSec,
    input.trimEndSec,
    input.customSteps,
  );
  return buildBiomechanicsAnalysis({ ...input, phases });
}

export { proposePhaseMarkers, enforceMonotonicMarkers } from '@/lib/biomechanics/phaseDetection';
export { samplePosesInTrimRange, nearestPoseSample, skeletonFramesToSamples } from '@/lib/biomechanics/poseSampling';
export * from '@/lib/biomechanics/customSteps';
export * from '@/lib/biomechanics/measurements';
export * from '@/lib/biomechanics/strokePhases';
export * from '@/lib/biomechanics/types';
