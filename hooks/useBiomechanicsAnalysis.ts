'use client';

import { useCallback, useRef, useState } from 'react';
import {
  buildBiomechanicsAnalysis,
  buildMeasurementsForPhases,
  createCustomStepId,
  DEFAULT_CUSTOM_STEPS,
  detectAndMeasure,
  enforceMonotonicMarkers,
  getPhaseDefinitions,
  makeStepShort,
  proposePhaseMarkers,
  samplePosesInTrimRange,
  skeletonFramesToSamples,
  syncMarkersWithDefinitions,
  type BiomechanicsAnalysis,
  type PhaseDefinition,
  type PhaseMarker,
  type PoseKeypoint,
  type PoseSample,
  type StrokeType,
} from '@/lib/biomechanics';

export type BiomechanicsStatus = 'idle' | 'sampling' | 'ready';

export function useBiomechanicsAnalysis(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [strokeType, setStrokeTypeState] = useState<StrokeType>('forehand');
  const [customSteps, setCustomSteps] = useState<PhaseDefinition[]>(DEFAULT_CUSTOM_STEPS);
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(0);
  const [phases, setPhases] = useState<PhaseMarker[]>([]);
  const [analysis, setAnalysis] = useState<BiomechanicsAnalysis | null>(null);
  const [status, setStatus] = useState<BiomechanicsStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const poseSamplesRef = useRef<PoseSample[]>([]);

  const effectiveCustomSteps = strokeType === 'custom' ? customSteps : undefined;

  const setStrokeType = useCallback((type: StrokeType) => {
    setPhases([]);
    setAnalysis(null);
    setSelectedPhaseId(null);
    poseSamplesRef.current = [];
    setStatus('idle');
    setProgress(0);
    if (type === 'custom') {
      setCustomSteps(DEFAULT_CUSTOM_STEPS);
    }
    setStrokeTypeState(type);
  }, []);

  const updatePhaseTime = useCallback((
    phaseId: string,
    timeSec: number,
    trimStart: number,
    trimEnd: number,
  ) => {
    setPhases((prev) => {
      const next = prev.map((p) =>
        p.id === phaseId ? { ...p, timeSec: Math.round(timeSec * 1000) / 1000 } : p,
      );
      return enforceMonotonicMarkers(next, trimStart, trimEnd);
    });
  }, []);

  const applyCustomSteps = useCallback((
    nextDefs: PhaseDefinition[],
    trimStart: number,
    trimEnd: number,
  ) => {
    setCustomSteps(nextDefs);
    setPhases((prev) => {
      const synced = syncMarkersWithDefinitions(nextDefs, prev, trimStart, trimEnd);
      return enforceMonotonicMarkers(synced, trimStart, trimEnd);
    });
  }, []);

  const addCustomStep = useCallback(() => {
    if (strokeType !== 'custom') return;
    const id = createCustomStepId();
    const label = `Step ${customSteps.length + 1}`;
    const def: PhaseDefinition = { id, label, short: makeStepShort(label, customSteps.length) };
    applyCustomSteps([...customSteps, def], trimStartSec, trimEndSec);
  }, [strokeType, customSteps, applyCustomSteps, trimStartSec, trimEndSec]);

  const renameCustomStep = useCallback((stepId: string, label: string) => {
    if (strokeType !== 'custom') return;
    const trimmed = label.trim() || 'Step';
    const nextDefs = customSteps.map((d, i) =>
      d.id === stepId
        ? { ...d, label: trimmed, short: makeStepShort(trimmed, i) }
        : d,
    );
    applyCustomSteps(nextDefs, trimStartSec, trimEndSec);
    setPhases((prev) =>
      prev.map((p) =>
        p.id === stepId
          ? { ...p, label: trimmed, short: makeStepShort(trimmed, nextDefs.findIndex((d) => d.id === stepId)) }
          : p,
      ),
    );
  }, [strokeType, customSteps, applyCustomSteps, trimStartSec, trimEndSec]);

  const deleteCustomStep = useCallback((stepId: string) => {
    if (strokeType !== 'custom' || customSteps.length <= 1) return;
    const nextDefs = customSteps.filter((d) => d.id !== stepId);
    applyCustomSteps(nextDefs, trimStartSec, trimEndSec);
    setSelectedPhaseId((prev) => (prev === stepId ? nextDefs[0]?.id ?? null : prev));
  }, [strokeType, customSteps, applyCustomSteps, trimStartSec, trimEndSec]);

  const reorderCustomStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    if (strokeType !== 'custom') return;
    const idx = customSteps.findIndex((d) => d.id === stepId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= customSteps.length) return;

    const nextDefs = [...customSteps];
    [nextDefs[idx], nextDefs[swapIdx]] = [nextDefs[swapIdx], nextDefs[idx]];

    setPhases((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      const reordered = nextDefs.map((d) => byId.get(d.id)).filter(Boolean) as PhaseMarker[];
      const withLabels = reordered.map((m, i) => ({
        ...m,
        label: nextDefs[i].label,
        short: nextDefs[i].short,
      }));
      return enforceMonotonicMarkers(withLabels, trimStartSec, trimEndSec);
    });
    setCustomSteps(nextDefs);
  }, [strokeType, customSteps, trimStartSec, trimEndSec]);

  const detectPhases = useCallback(async (opts?: {
    skeletonFrames?: Array<{ timeSeconds: number; keypoints: PoseKeypoint[] }>;
  }) => {
    const video = videoRef.current;
    if (!video || trimEndSec <= trimStartSec) return null;
    if (strokeType === 'custom' && customSteps.length === 0) return null;

    setStatus('sampling');
    setProgress(0);

    let samples: PoseSample[] = [];
    if (opts?.skeletonFrames?.length) {
      const filtered = opts.skeletonFrames.filter(
        (f) => f.timeSeconds >= trimStartSec && f.timeSeconds <= trimEndSec,
      );
      samples = skeletonFramesToSamples(filtered);
    }
    if (samples.length < 3) {
      samples = await samplePosesInTrimRange(
        video,
        trimStartSec,
        trimEndSec,
        15,
        (p) => setProgress(Math.round(p * 100)),
      );
    }

    poseSamplesRef.current = samples;
    const proposed = proposePhaseMarkers(
      strokeType,
      samples,
      trimStartSec,
      trimEndSec,
      effectiveCustomSteps,
    );
    setPhases(proposed);
    setSelectedPhaseId(
      proposed.find((p) => p.id === 'contact')?.id ?? proposed[0]?.id ?? null,
    );

    const result = buildBiomechanicsAnalysis({
      strokeType,
      trimStartSec,
      trimEndSec,
      phases: proposed,
      poseSamples: samples,
      customSteps: effectiveCustomSteps,
    });
    setAnalysis(result);
    setStatus('ready');
    setProgress(100);
    return result;
  }, [strokeType, customSteps, effectiveCustomSteps, trimEndSec, trimStartSec, videoRef]);

  const clearAnalysis = useCallback(() => {
    setPhases([]);
    setAnalysis(null);
    setSelectedPhaseId(null);
    poseSamplesRef.current = [];
    setStatus('idle');
    setProgress(0);
  }, []);

  const refreshMeasurements = useCallback(() => {
    if (phases.length === 0) return;
    const measurements = buildMeasurementsForPhases(phases, poseSamplesRef.current);
    setAnalysis((prev) => prev
      ? {
          ...prev,
          phases,
          measurements,
          ...(strokeType === 'custom' ? { customSteps } : {}),
        }
      : buildBiomechanicsAnalysis({
          strokeType,
          trimStartSec,
          trimEndSec,
          phases,
          poseSamples: poseSamplesRef.current,
          customSteps: effectiveCustomSteps,
        }));
    setStatus('ready');
  }, [phases, strokeType, customSteps, effectiveCustomSteps, trimEndSec, trimStartSec]);

  return {
    strokeType,
    setStrokeType,
    customSteps,
    addCustomStep,
    renameCustomStep,
    deleteCustomStep,
    reorderCustomStep,
    trimStartSec,
    setTrimStartSec,
    trimEndSec,
    setTrimEndSec,
    phases,
    setPhases,
    analysis,
    status,
    isProcessing: status === 'sampling',
    progress,
    selectedPhaseId,
    setSelectedPhaseId,
    updatePhaseTime,
    detectPhases,
    refreshMeasurements,
    clearAnalysis,
    phaseDefinitions: getPhaseDefinitions(strokeType, effectiveCustomSteps),
  };
}
