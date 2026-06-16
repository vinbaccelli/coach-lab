import type { BiomechanicsAnalysis, StrokeType } from '@/lib/biomechanics/types';

export type SessionStatus = 'draft' | 'saved';

export type AnalysisType =
  | 'stromotion'
  | 'ai_metrics'
  | 'combined'
  | 'recording'
  | 'other';

export type VideoRefKind = 'none' | 'youtube' | 'cloud_url' | 'supabase';

export interface VideoReference {
  kind: VideoRefKind;
  url?: string;
  storagePath?: string;
  label?: string;
}

export type SessionArtifactKind =
  | 'stromotion_png'
  | 'stromotion_video'
  | 'metrics_frame'
  | 'metrics_json'
  | 'phase_screenshot'
  | 'source_video';

export interface SessionArtifact {
  id: string;
  kind: SessionArtifactKind;
  mime: string;
  storagePath: string;
  publicUrl?: string;
  label?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface FrameMarker {
  index: number;
  label: string;
  timeSec: number;
}

export interface ExternalLinks {
  googleDocUrl?: string;
  shareUrl?: string;
  [key: string]: string | undefined;
}

/** Persisted session row (API / DB shape). */
export interface PlayerSession {
  id: string;
  coachId: string;
  playerId: string;
  title: string;
  coachNotes: string;
  analysisType: AnalysisType;
  strokeType?: StrokeType | null;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  videoRef: VideoReference;
  measurements?: BiomechanicsAnalysis | null;
  frameMarkers?: FrameMarker[] | null;
  toolConfig: Record<string, unknown>;
  artifacts: SessionArtifact[];
  externalLinks: ExternalLinks;
  source: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Pending artifact blob before upload. */
export interface PendingArtifact {
  id: string;
  kind: SessionArtifactKind;
  mime: string;
  label?: string;
  blob?: Blob;
  dataUrl?: string;
  width?: number;
  height?: number;
}

export interface StroMotionSessionSlice {
  ghostCount: number;
  sampleTimes: number[];
  trimStartSec: number;
  trimEndSec: number;
  pendingArtifacts: PendingArtifact[];
}

export interface AIMetricsSessionSlice {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  frameMarkers: FrameMarker[];
  measurements?: BiomechanicsAnalysis | null;
  pendingArtifacts: PendingArtifact[];
}

export interface RecordingSessionSlice {
  youtubeUrl?: string;
  pendingArtifacts: PendingArtifact[];
}

/** In-memory draft before save. */
export interface SessionDraft {
  analysisType: AnalysisType;
  title: string;
  coachNotes: string;
  strokeType?: StrokeType;
  trim: { startSec: number; endSec: number };
  videoRef: VideoReference;
  stroMotion?: StroMotionSessionSlice;
  aiMetrics?: AIMetricsSessionSlice;
  recording?: RecordingSessionSlice;
}

export interface CreateSessionRequest {
  title: string;
  coachNotes?: string;
  analysisType: AnalysisType;
  strokeType?: StrokeType | null;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  videoRef?: VideoReference;
  measurements?: BiomechanicsAnalysis | null;
  frameMarkers?: FrameMarker[] | null;
  toolConfig?: Record<string, unknown>;
  externalLinks?: ExternalLinks;
  source?: string;
  status?: SessionStatus;
  artifacts?: SessionArtifact[];
}

export interface UpdateSessionRequest {
  title?: string;
  coachNotes?: string;
  analysisType?: AnalysisType;
  strokeType?: StrokeType | null;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  videoRef?: VideoReference;
  measurements?: BiomechanicsAnalysis | null;
  frameMarkers?: FrameMarker[] | null;
  toolConfig?: Record<string, unknown>;
  externalLinks?: ExternalLinks;
  source?: string;
  status?: SessionStatus;
}

/** DB row shape (snake_case). */
export interface PlayerSessionRow {
  id: string;
  coach_id: string;
  player_id: string;
  title: string;
  coach_notes: string;
  analysis_type: AnalysisType;
  stroke_type: string | null;
  trim_start_sec: number | null;
  trim_end_sec: number | null;
  video_ref: VideoReference;
  measurements: BiomechanicsAnalysis | null;
  frame_markers: FrameMarker[] | null;
  tool_config: Record<string, unknown>;
  artifacts: SessionArtifact[];
  external_links: ExternalLinks;
  source: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export function rowToPlayerSession(row: PlayerSessionRow): PlayerSession {
  return {
    id: row.id,
    coachId: row.coach_id,
    playerId: row.player_id,
    title: row.title,
    coachNotes: row.coach_notes,
    analysisType: row.analysis_type,
    strokeType: (row.stroke_type as StrokeType | null) ?? null,
    trimStartSec: row.trim_start_sec,
    trimEndSec: row.trim_end_sec,
    videoRef: row.video_ref ?? { kind: 'none' },
    measurements: row.measurements,
    frameMarkers: row.frame_markers,
    toolConfig: row.tool_config ?? {},
    artifacts: row.artifacts ?? [],
    externalLinks: row.external_links ?? {},
    source: row.source,
    status: row.status ?? 'saved',
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export function sessionDraftHasContent(draft: SessionDraft): boolean {
  const hasStro = (draft.stroMotion?.pendingArtifacts.length ?? 0) > 0;
  const hasMetrics = (draft.aiMetrics?.pendingArtifacts.length ?? 0) > 0;
  const hasRecording = (draft.recording?.pendingArtifacts.length ?? 0) > 0
    || !!draft.recording?.youtubeUrl;
  const hasNotes = draft.coachNotes.trim().length > 0;
  const hasVideo = draft.videoRef.kind !== 'none' && !!(draft.videoRef.url || draft.videoRef.storagePath);
  return hasStro || hasMetrics || hasRecording || hasNotes || hasVideo;
}

export function resolveAnalysisType(draft: SessionDraft): AnalysisType {
  const hasStro = (draft.stroMotion?.pendingArtifacts.length ?? 0) > 0;
  const hasMetrics = (draft.aiMetrics?.pendingArtifacts.length ?? 0) > 0;
  const hasRecording = !!draft.recording;
  if (hasStro && hasMetrics) return 'combined';
  if (hasStro) return 'stromotion';
  if (hasMetrics) return 'ai_metrics';
  if (hasRecording) return 'recording';
  return draft.analysisType;
}
