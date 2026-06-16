import type {
  CreateSessionRequest,
  UpdateSessionRequest,
  PlayerSessionRow,
  VideoReference,
  SessionArtifact,
  ExternalLinks,
  AnalysisType,
  SessionStatus,
} from '@/lib/sessions/types';

export function createSessionInsert(
  coachId: string,
  playerId: string,
  body: CreateSessionRequest,
) {
  return {
    coach_id: coachId,
    player_id: playerId,
    title: body.title.trim(),
    coach_notes: body.coachNotes ?? '',
    analysis_type: body.analysisType as AnalysisType,
    stroke_type: body.strokeType ?? null,
    trim_start_sec: body.trimStartSec ?? null,
    trim_end_sec: body.trimEndSec ?? null,
    video_ref: (body.videoRef ?? { kind: 'none' }) as VideoReference,
    measurements: body.measurements ?? null,
    frame_markers: body.frameMarkers ?? null,
    tool_config: body.toolConfig ?? {},
    artifacts: (body.artifacts ?? []) as SessionArtifact[],
    external_links: (body.externalLinks ?? {}) as ExternalLinks,
    source: body.source ?? 'analysis',
    status: (body.status ?? 'saved') as SessionStatus,
  };
}

export function updateSessionPatch(body: UpdateSessionRequest): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title.trim();
  if (body.coachNotes !== undefined) patch.coach_notes = body.coachNotes;
  if (body.analysisType !== undefined) patch.analysis_type = body.analysisType;
  if (body.strokeType !== undefined) patch.stroke_type = body.strokeType;
  if (body.trimStartSec !== undefined) patch.trim_start_sec = body.trimStartSec;
  if (body.trimEndSec !== undefined) patch.trim_end_sec = body.trimEndSec;
  if (body.videoRef !== undefined) patch.video_ref = body.videoRef;
  if (body.measurements !== undefined) patch.measurements = body.measurements;
  if (body.frameMarkers !== undefined) patch.frame_markers = body.frameMarkers;
  if (body.toolConfig !== undefined) patch.tool_config = body.toolConfig;
  if (body.externalLinks !== undefined) patch.external_links = body.externalLinks;
  if (body.source !== undefined) patch.source = body.source;
  if (body.status !== undefined) patch.status = body.status;
  return patch;
}

export type { PlayerSessionRow };
