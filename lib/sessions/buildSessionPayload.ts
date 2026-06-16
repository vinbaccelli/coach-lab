import type {
  CreateSessionRequest,
  FrameMarker,
  SessionArtifact,
  SessionDraft,
  StroMotionSessionSlice,
  AIMetricsSessionSlice,
} from '@/lib/sessions/types';
import { resolveAnalysisType } from '@/lib/sessions/types';

function buildToolConfig(draft: SessionDraft): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (draft.stroMotion) {
    config.stroMotion = {
      ghostCount: draft.stroMotion.ghostCount,
      sampleTimes: draft.stroMotion.sampleTimes,
    };
  }
  if (draft.aiMetrics) {
    config.aiMetrics = {
      strokeType: draft.aiMetrics.strokeType,
      frameMarkers: draft.aiMetrics.frameMarkers,
    };
  }
  return config;
}

function mergeFrameMarkers(draft: SessionDraft): FrameMarker[] | null {
  const fromMetrics = draft.aiMetrics?.frameMarkers ?? [];
  const fromStro = (draft.stroMotion?.sampleTimes ?? []).map((timeSec, index) => ({
    index,
    label: String(index + 1),
    timeSec,
  }));
  const merged = fromMetrics.length > 0 ? fromMetrics : fromStro;
  return merged.length > 0 ? merged : null;
}

export function buildCreateSessionRequest(
  draft: SessionDraft,
  uploadedArtifacts: SessionArtifact[],
): CreateSessionRequest {
  const analysisType = resolveAnalysisType(draft);
  return {
    title: draft.title.trim() || 'Analysis session',
    coachNotes: draft.coachNotes,
    analysisType,
    strokeType: draft.strokeType ?? draft.aiMetrics?.strokeType ?? null,
    trimStartSec: draft.trim.startSec,
    trimEndSec: draft.trim.endSec,
    videoRef: draft.videoRef,
    measurements: draft.aiMetrics?.measurements ?? null,
    frameMarkers: mergeFrameMarkers(draft),
    toolConfig: buildToolConfig(draft),
    externalLinks: {},
    source: 'analysis',
    status: 'saved',
    artifacts: uploadedArtifacts,
  };
}

export function collectPendingArtifacts(draft: SessionDraft) {
  const list = [
    ...(draft.stroMotion?.pendingArtifacts ?? []),
    ...(draft.aiMetrics?.pendingArtifacts ?? []),
    ...(draft.recording?.pendingArtifacts ?? []),
  ];
  return list;
}

export type { StroMotionSessionSlice, AIMetricsSessionSlice };
