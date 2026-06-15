/** CoachLab V1 — biomechanical analysis types (measurements only, no scores). */

export type StrokeType =
  | 'forehand'
  | 'two_handed_backhand'
  | 'one_handed_backhand'
  | 'serve'
  | 'volley'
  | 'smash'
  | 'custom';

export interface PoseKeypoint {
  x: number;
  y: number;
  score: number;
  name: string;
}

export interface PoseSample {
  timeSec: number;
  keypoints: PoseKeypoint[] | null;
}

export interface PhaseDefinition {
  id: string;
  label: string;
  short: string;
}

export interface PhaseMarker {
  id: string;
  label: string;
  short: string;
  timeSec: number;
}

export interface JointAngles {
  leftElbowDeg: number | null;
  rightElbowDeg: number | null;
  leftKneeDeg: number | null;
  rightKneeDeg: number | null;
  leftShoulderDeg: number | null;
  rightShoulderDeg: number | null;
}

export interface FootSpacing {
  absolutePx: number;
  normalizedToShoulderWidth: number;
}

export interface FootDirection {
  leftFootDeg: number | null;
  rightFootDeg: number | null;
}

export interface StringbedDirection {
  available: boolean;
  degrees: number | null;
  confidence: number;
  note?: string;
}

/** Objective balance signals — no composite score. */
export interface BalanceMetrics {
  /** Ankle midpoint vs hip midpoint, horizontal offset normalized to shoulder width */
  lateralComOffsetNormalized: number | null;
  /** Ankle midpoint vs hip midpoint, vertical offset in px (positive = ankles below hips) */
  verticalComOffsetPx: number | null;
  /** Absolute difference between left and right foot direction angles */
  footOrientationSpreadDeg: number | null;
  /** Stance width relative to shoulder width (from foot spacing) */
  stanceWidthNormalized: number | null;
}

export interface PhaseMeasurements {
  phaseId: string;
  phaseLabel: string;
  timeSec: number;
  jointAngles: JointAngles;
  shoulderHipSeparationDeg: number | null;
  footSpacing: FootSpacing | null;
  footDirection: FootDirection;
  balance: BalanceMetrics;
  racketAngleDeg: number | null;
  stringbedDirection: StringbedDirection;
}

export interface BiomechanicsAnalysis {
  strokeType: StrokeType;
  trimStartSec: number;
  trimEndSec: number;
  phases: PhaseMarker[];
  measurements: PhaseMeasurements[];
  /** Present when strokeType is custom — coach-defined step model */
  customSteps?: PhaseDefinition[];
  fps: number;
}

export interface BiomechanicsExportManifest {
  phaseScreenshots: Array<{ phaseId: string; filename: string }>;
  stroMotionFilename: string;
  slowMotionFilename: string;
}
