import type { AnalysisType, SessionArtifact, SessionArtifactKind } from '@/lib/sessions/types';

/**
 * DISPLAY-TIME label sanitization for saved sessions/artifacts.
 *
 * "StroMotion" was Dartfish's term and was renamed to "Motion Layer" everywhere
 * user-facing. That rename touched CODE — the strings the app writes going
 * forward — but sessions saved BEFORE it have the old word frozen into stored
 * free-text fields (`session.title`, `artifact.label`), e.g. "... — StroMotion"
 * or "StroMotion animation". Those rows are not migrated: the persisted
 * `AnalysisType`/`SessionArtifactKind` enum values ('stromotion',
 * 'stromotion_png', 'stromotion_video') are internal discriminants, not display
 * text, and are deliberately left alone (renaming them is a schema change, not
 * a copy fix). Instead, every render site reads stored text through the helpers
 * below, which replace the brand text on the way to the screen. The database
 * value is never touched.
 */

/** Case-insensitive; always renders "Motion Layer" regardless of the stored casing. */
const LEGACY_BRAND_RE = /stro\s*motion/gi;

/** Strip any old-brand text out of a stored free-text field before displaying it. */
export function sanitizeLegacyLabel(text: string): string {
  return text.replace(LEGACY_BRAND_RE, 'Motion Layer');
}

const ANALYSIS_TYPE_LABELS: Record<AnalysisType, string> = {
  stromotion: 'Motion Layer',
  ai_metrics: 'AI Metrics',
  combined: 'Combined analysis',
  recording: 'Recording',
  other: 'Analysis',
};

/**
 * Display label for a session's `analysisType`. Safe for sessions saved at any
 * time: the enum KEY ('stromotion') never changes, only what this map prints
 * for it — so an old and a new session with the same type show identically.
 */
export function analysisTypeLabel(type: AnalysisType | string): string {
  return ANALYSIS_TYPE_LABELS[type as AnalysisType] ?? type;
}

const ARTIFACT_KIND_LABELS: Record<SessionArtifactKind, string> = {
  stromotion_png: 'Motion Layer image',
  stromotion_video: 'Motion Layer video',
  metrics_frame: 'Metrics frame',
  metrics_json: 'Measurements',
  phase_screenshot: 'Phase screenshot',
  source_video: 'Source video',
};

/**
 * Friendly fallback label derived from an artifact's `kind`, for the rare case
 * no `label` was stored. Every adapter sets one today, so this mainly guards
 * against showing a raw snake_case enum value if that ever changes.
 */
export function artifactKindLabel(kind: SessionArtifactKind | string): string {
  return ARTIFACT_KIND_LABELS[kind as SessionArtifactKind] ?? kind;
}

/**
 * THE label to show for a session artifact: the stored `label`, sanitized of
 * any old brand text, or a friendly kind-based fallback when there is none.
 * This is the one function every artifact-rendering call site should use.
 */
export function displayArtifactLabel(
  artifact: Pick<SessionArtifact, 'kind'> & { label?: string | null },
): string {
  if (artifact.label) return sanitizeLegacyLabel(artifact.label);
  return artifactKindLabel(artifact.kind);
}
