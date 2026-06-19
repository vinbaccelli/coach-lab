'use client';

import {
  createCustomStepId,
  DEFAULT_CUSTOM_STEPS,
  makeStepShort,
  type PhaseDefinition,
  type PhaseMeasurements,
  type StrokeType,
} from '@/lib/biomechanics';
import { buildAnalysisFromDraft } from '@/lib/aiMetricsDraft/exportFromDraft';
import { ensureAIMetricsDraft } from '@/lib/aiMetricsDraft/initDraft';
import {
  allFramesReady,
  clonePhaseMeasurements,
  countReadyFrames,
} from '@/lib/aiMetricsDraft/measurementValues';
import { proposeFrameMeasurements } from '@/lib/aiMetricsDraft/proposeFrameMeasurements';
import type {
  AIMetricsDraft,
  AIMetricsFrameDraft,
  AIMetricsFrameStatus,
  AIMetricsModuleId,
} from '@/lib/aiMetricsDraft/types';
import { DEFAULT_ENABLED_MODULES } from '@/lib/aiMetricsDraft/types';
import type { PoseSample } from '@/lib/biomechanics/types';
import { useCallback, useRef, useState } from 'react';

export type AIMetricsHookStatus = 'idle' | 'configuring' | 'proposing' | 'generating' | 'ready';

export interface SyncAIMetricsDraftParams {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  sampleTimes: number[];
  customSteps?: PhaseDefinition[];
}

export function useAIMetrics(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [draft, setDraft] = useState<AIMetricsDraft | null>(null);
  const [status, setStatus] = useState<AIMetricsHookStatus>('idle');
  const [strokeType, setStrokeTypeState] = useState<StrokeType>('forehand');
  const [customSteps, setCustomSteps] = useState<PhaseDefinition[]>(DEFAULT_CUSTOM_STEPS);
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(0);
  const [activeFrameIndex, setActiveFrameIndex] = useState<number | null>(null);
  const [proposingFrameIndex, setProposingFrameIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const draftRef = useRef<AIMetricsDraft | null>(null);
  draftRef.current = draft;

  const effectiveCustomSteps = strokeType === 'custom' ? customSteps : undefined;

  const clearDraftState = useCallback(() => {
    setDraft(null);
    setActiveFrameIndex(null);
    setProposingFrameIndex(null);
    setProgress(0);
  }, []);

  const clearAll = useCallback(() => {
    clearDraftState();
    setStatus('idle');
    setStrokeTypeState('forehand');
    setCustomSteps(DEFAULT_CUSTOM_STEPS);
  }, [clearDraftState]);

  const invalidateReport = useCallback(() => {
    setStatus((prev) => (prev === 'ready' ? 'configuring' : prev));
  }, []);

  const setStrokeType = useCallback((type: StrokeType) => {
    setStrokeTypeState(type);
    clearDraftState();
    setStatus('idle');
    if (type === 'custom') {
      setCustomSteps(DEFAULT_CUSTOM_STEPS);
    }
  }, [clearDraftState]);

  const syncDraft = useCallback((params: SyncAIMetricsDraftParams): AIMetricsDraft => {
    const next = ensureAIMetricsDraft({
      strokeType: params.strokeType,
      trimStartSec: params.trimStartSec,
      trimEndSec: params.trimEndSec,
      sampleTimes: params.sampleTimes,
      customSteps: params.customSteps,
      previous: draftRef.current,
    });
    setDraft(next);
    setStatus('configuring');
    return next;
  }, []);

  const invalidateFrameAt = useCallback((frameIndex: number, timeSec?: number, label?: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (f.index !== frameIndex) return f;
        return {
          ...f,
          timeSec: timeSec ?? f.timeSec,
          label: label ?? f.label,
          status: 'pending' as AIMetricsFrameStatus,
          poseSample: null,
          ai: null,
          coach: null,
          ready: null,
        };
      });
      const sampleTimes = [...prev.sampleTimes];
      if (timeSec !== undefined && frameIndex >= 0 && frameIndex < sampleTimes.length) {
        sampleTimes[frameIndex] = timeSec;
      }
      return { ...prev, frames, sampleTimes };
    });
    invalidateReport();
  }, [invalidateReport]);

  const updateFrameTime = useCallback((frameIndex: number, timeSec: number) => {
    invalidateFrameAt(frameIndex, timeSec);
  }, [invalidateFrameAt]);

  const updateFrameLabel = useCallback((frameIndex: number, label: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex ? { ...f, label } : f,
      );
      return { ...prev, frames };
    });
  }, []);

  const updateEnabledModule = useCallback((moduleId: AIMetricsModuleId, enabled: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        enabledModules: { ...prev.enabledModules, [moduleId]: enabled },
      };
    });
  }, []);

  const proposeMeasurementsForFrame = useCallback(async (frameIndex: number): Promise<boolean> => {
    const video = videoRef.current;
    const current = draftRef.current;
    if (!video || !current) return false;

    const frame = current.frames[frameIndex];
    if (!frame) return false;

    setProposingFrameIndex(frameIndex);
    setProgress(0);
    setStatus('proposing');

    try {
      const frameId = `frame-${frameIndex}`;
      const result = await proposeFrameMeasurements(
        video,
        frameId,
        frame.label,
        frame.timeSec,
      );

      if (!result) return false;

      setDraft((prev) => {
        if (!prev) return prev;
        const frames = prev.frames.map((f) =>
          f.index === frameIndex
            ? {
                ...f,
                poseSample: result.poseSample,
                ai: result.ai,
                coach: result.coach,
                ready: null,
                status: 'edited' as AIMetricsFrameStatus,
              }
            : f,
        );
        return { ...prev, frames };
      });
      invalidateReport();
      setProgress(100);
      return true;
    } finally {
      setProposingFrameIndex(null);
      setProgress(0);
      setStatus('configuring');
    }
  }, [invalidateReport, videoRef]);

  const updateFrameMeasurements = useCallback((frameIndex: number, measurements: PhaseMeasurements) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex
          ? {
              ...f,
              coach: measurements,
              ready: null,
              status: 'edited' as AIMetricsFrameStatus,
            }
          : f,
      );
      return { ...prev, frames };
    });
    invalidateReport();
  }, [invalidateReport]);

  const resetFrameMeasurements = useCallback((frameIndex: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex && f.ai
          ? {
              ...f,
              coach: clonePhaseMeasurements(f.ai),
              ready: null,
              status: 'edited' as AIMetricsFrameStatus,
            }
          : f,
      );
      return { ...prev, frames };
    });
    invalidateReport();
  }, [invalidateReport]);

  const reproposeFrameMeasurements = useCallback(async (frameIndex: number): Promise<boolean> => {
    return proposeMeasurementsForFrame(frameIndex);
  }, [proposeMeasurementsForFrame]);

  const markFrameReady = useCallback((frameIndex: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) => {
        if (f.index !== frameIndex) return f;
        const working = f.coach ?? f.ai;
        if (!working) return f;
        return {
          ...f,
          ready: clonePhaseMeasurements(working),
          status: 'ready' as AIMetricsFrameStatus,
        };
      });
      return { ...prev, frames };
    });
    invalidateReport();
  }, [invalidateReport]);

  const addFrame = useCallback((timeSec: number) => {
    setDraft((prev) => {
      const newFrame: AIMetricsFrameDraft = {
        index: 0,
        timeSec,
        label: 'Frame 1',
        status: 'pending',
        poseSample: null,
        ai: null,
        coach: null,
        ready: null,
        enabledModules: prev?.enabledModules ? { ...prev.enabledModules } : { ...DEFAULT_ENABLED_MODULES },
        skeletonStamp: null,
        coachDrawingJson: null,
      };
      if (!prev) {
        // After Clear: create a fresh draft with just this one frame
        return {
          strokeType: strokeType,
          trimStartSec: trimStartSec,
          trimEndSec: trimEndSec,
          sampleTimes: [timeSec],
          enabledModules: { ...DEFAULT_ENABLED_MODULES },
          frames: [newFrame],
          customSteps: effectiveCustomSteps,
        } as AIMetricsDraft;
      }
      newFrame.index = prev.frames.length;
      newFrame.label = `Frame ${prev.frames.length + 1}`;
      const allFrames = [...prev.frames, newFrame].sort((a, b) => a.timeSec - b.timeSec);
      const frames = allFrames.map((f, i) => ({ ...f, index: i }));
      const sampleTimes = frames.map((f) => f.timeSec);
      return { ...prev, frames, sampleTimes };
    });
    setStatus('configuring');
    invalidateReport();
  }, [invalidateReport, strokeType, trimStartSec, trimEndSec, effectiveCustomSteps]);

  const removeFrame = useCallback((frameIndex: number) => {
    setDraft((prev) => {
      if (!prev || prev.frames.length <= 1) return prev;
      const frames = prev.frames
        .filter((f) => f.index !== frameIndex)
        .map((f, i) => ({ ...f, index: i }));
      const sampleTimes = frames.map((f) => f.timeSec);
      return { ...prev, frames, sampleTimes };
    });
    invalidateReport();
  }, [invalidateReport]);

  const updateFrameEnabledModule = useCallback((
    frameIndex: number,
    moduleId: AIMetricsModuleId,
    enabled: boolean,
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex
          ? { ...f, enabledModules: { ...f.enabledModules, [moduleId]: enabled } }
          : f,
      );
      return { ...prev, frames };
    });
  }, []);

  const setFrameSkeletonStamp = useCallback((frameIndex: number, stamp: PoseSample | null) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const frames = prev.frames.map((f) =>
        f.index === frameIndex ? { ...f, skeletonStamp: stamp } : f,
      );
      return { ...prev, frames };
    });
  }, []);

  const generateReport = useCallback(() => {
    const current = draftRef.current;
    if (!current || !allFramesReady(current.frames)) return null;
    setStatus('generating');
    const analysis = buildAnalysisFromDraft(current);
    setStatus(analysis ? 'ready' : 'configuring');
    return analysis;
  }, []);

  const addCustomStep = useCallback(() => {
    if (strokeType !== 'custom') return;
    const id = createCustomStepId();
    const label = `Step ${customSteps.length + 1}`;
    setCustomSteps((prev) => [...prev, { id, label, short: makeStepShort(label, customSteps.length) }]);
  }, [strokeType, customSteps.length]);

  const renameCustomStep = useCallback((stepId: string, label: string) => {
    if (strokeType !== 'custom') return;
    const trimmed = label.trim() || 'Step';
    setCustomSteps((prev) =>
      prev.map((d, i) =>
        d.id === stepId
          ? { ...d, label: trimmed, short: makeStepShort(trimmed, i) }
          : d,
      ),
    );
  }, [strokeType]);

  const deleteCustomStep = useCallback((stepId: string) => {
    if (strokeType !== 'custom' || customSteps.length <= 1) return;
    setCustomSteps((prev) => prev.filter((d) => d.id !== stepId));
  }, [strokeType, customSteps.length]);

  const reorderCustomStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    if (strokeType !== 'custom') return;
    const idx = customSteps.findIndex((d) => d.id === stepId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= customSteps.length) return;
    setCustomSteps((prev) => {
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, [strokeType, customSteps]);

  const autoProposeAllFrames = useCallback(async (): Promise<number> => {
    const current = draftRef.current;
    if (!current) return 0;
    const pending = current.frames.filter(f => !f.poseSample);
    if (pending.length === 0) return 0;
    let count = 0;
    for (const frame of pending) {
      const ok = await proposeMeasurementsForFrame(frame.index);
      if (ok) count++;
    }
    return count;
  }, [proposeMeasurementsForFrame]);

  return {
    draft,
    status,
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
    activeFrameIndex,
    setActiveFrameIndex,
    proposingFrameIndex,
    isProposingFrame: proposingFrameIndex !== null,
    isGenerating: status === 'generating',
    isProcessing: status === 'proposing' || status === 'generating',
    progress,
    showSkeleton,
    setShowSkeleton,
    syncDraft,
    addFrame,
    removeFrame,
    updateFrameTime,
    updateFrameLabel,
    updateEnabledModule,
    updateFrameEnabledModule,
    setFrameSkeletonStamp,
    proposeMeasurementsForFrame,
    updateFrameMeasurements,
    resetFrameMeasurements,
    reproposeFrameMeasurements,
    markFrameReady,
    generateReport,
    invalidateReport,
    clearAll,
    autoProposeAllFrames,
    readyCount: draft ? countReadyFrames(draft.frames) : 0,
    enabledModules: draft?.enabledModules ?? DEFAULT_ENABLED_MODULES,
  };
}
