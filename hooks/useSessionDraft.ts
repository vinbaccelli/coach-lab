'use client';

import { useCallback, useMemo, useState } from 'react';
import type { StrokeType } from '@/lib/biomechanics/types';
import { buildAIMetricsSessionSlice } from '@/lib/sessions/adapters/aiMetricsAdapter';
import type { AIMetricsFrameCard } from '@/lib/sessions/adapters/aiMetricsAdapter';
import { buildStroMotionSessionSlice } from '@/lib/sessions/adapters/stroMotionAdapter';
import type { StroMotionAdapterInput } from '@/lib/sessions/adapters/stroMotionAdapter';
import type { BiomechanicsAnalysis } from '@/lib/biomechanics/types';
import type {
  AnalysisType,
  SessionDraft,
  VideoReference,
} from '@/lib/sessions/types';
import { resolveAnalysisType, sessionDraftHasContent } from '@/lib/sessions/types';

function defaultDraft(): SessionDraft {
  return {
    analysisType: 'other',
    title: '',
    coachNotes: '',
    trim: { startSec: 0, endSec: 0 },
    videoRef: { kind: 'none' },
  };
}

export function useSessionDraft() {
  const [draft, setDraft] = useState<SessionDraft>(defaultDraft);

  const hasContent = useMemo(() => sessionDraftHasContent(draft), [draft]);

  const setTitle = useCallback((title: string) => {
    setDraft((d) => ({ ...d, title }));
  }, []);

  const setCoachNotes = useCallback((coachNotes: string) => {
    setDraft((d) => ({ ...d, coachNotes }));
  }, []);

  const setVideoRef = useCallback((videoRef: VideoReference) => {
    setDraft((d) => ({ ...d, videoRef }));
  }, []);

  const setTrim = useCallback((startSec: number, endSec: number) => {
    setDraft((d) => ({ ...d, trim: { startSec, endSec } }));
  }, []);

  const setStrokeType = useCallback((strokeType: StrokeType) => {
    setDraft((d) => ({ ...d, strokeType }));
  }, []);

  const applyStroMotion = useCallback((input: StroMotionAdapterInput) => {
    const slice = buildStroMotionSessionSlice(input);
    setDraft((d) => ({
      ...d,
      analysisType: resolveAnalysisType({
        ...d,
        stroMotion: slice,
      }),
      trim: { startSec: input.trimStartSec, endSec: input.trimEndSec },
      stroMotion: slice,
    }));
  }, []);

  const applyAIMetrics = useCallback((input: {
    strokeType: StrokeType;
    trimStartSec: number;
    trimEndSec: number;
    frameCards: AIMetricsFrameCard[];
    sampleTimes: number[];
    measurements?: BiomechanicsAnalysis | null;
  }) => {
    const slice = buildAIMetricsSessionSlice(input);
    setDraft((d) => ({
      ...d,
      analysisType: resolveAnalysisType({
        ...d,
        aiMetrics: slice,
      }),
      strokeType: input.strokeType,
      trim: { startSec: input.trimStartSec, endSec: input.trimEndSec },
      aiMetrics: slice,
    }));
  }, []);

  const applyRecording = useCallback((youtubeUrl?: string) => {
    setDraft((d) => ({
      ...d,
      analysisType: 'recording' as AnalysisType,
      recording: {
        youtubeUrl,
        pendingArtifacts: [],
      },
      videoRef: youtubeUrl
        ? { kind: 'youtube', url: youtubeUrl }
        : d.videoRef,
    }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(defaultDraft());
  }, []);

  return {
    draft,
    hasContent,
    setTitle,
    setCoachNotes,
    setVideoRef,
    setTrim,
    setStrokeType,
    applyStroMotion,
    applyAIMetrics,
    applyRecording,
    resetDraft,
  };
}
