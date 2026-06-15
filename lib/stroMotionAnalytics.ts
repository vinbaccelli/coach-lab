/**
 * Biomechanical data contract layer for StroMotion output.
 * Deterministic structuring only — no AI/ML, no rendering, no StroMotion mutations.
 */

import type { StroMotionResult, StroMotionSubjectBox } from '@/lib/stroMotion';
import {
  dominantArmIndices,
  estimateTennisRacketZones,
  pixelRectArea,
  POSE_IDX,
  type StroMotionPoseKeypoint,
} from '@/lib/stroMotionPose';

export const STRO_ANALYTICS_SCHEMA_VERSION = '1.0.0';

const MIN_POSE_SCORE = 0.2;

// ─── Phase labels ───────────────────────────────────────────────────────────

export type StrokePhaseLabel = 'prep' | 'swing' | 'follow_through';

// ─── StrokeData schema ──────────────────────────────────────────────────────

export interface PhaseSegment {
  phase: StrokePhaseLabel;
  startTime: number;
  endTime: number;
  startIndex: number;
  endIndex: number;
  durationSec: number;
}

export interface SerializableKeypoint {
  x: number;
  y: number;
  score: number;
  name: string;
}

export interface PoseSnapshot {
  index: number;
  time: number;
  keypoints: SerializableKeypoint[] | null;
  dominantArm: 'left' | 'right' | 'unknown';
}

export interface RacketZoneSignal {
  index: number;
  time: number;
  zoneCount: number;
  combinedAreaPx: number;
  forwardHeadActive: boolean;
  backswingActive: boolean;
  overheadActive: boolean;
  twoHandActive: boolean;
  engagementScore: number;
}

export interface MotionIntensityPoint {
  index: number;
  time: number;
  intensity: number;
}

export interface StabilityMetrics {
  phase: StrokePhaseLabel;
  comJitterPx: number;
  shoulderTiltStdDeg: number;
  hipShoulderSeparationStd: number;
  score: number;
}

export interface StrokeData {
  strokeId: string;
  timestamps: number[];
  phases: PhaseSegment[];
  poseEvolution: PoseSnapshot[];
  racketZoneTimeline: RacketZoneSignal[];
  motionIntensityCurve: MotionIntensityPoint[];
  stabilityByPhase: StabilityMetrics[];
}

// ─── Feature bundles (AI-ready contract) ────────────────────────────────────

export interface TemporalFeatures {
  totalDurationSec: number;
  phaseDurations: Record<StrokePhaseLabel, number>;
  phaseTimeRatios: Record<StrokePhaseLabel, number>;
  prepToSwingRatio: number;
  swingToFollowRatio: number;
}

export interface KinematicFeatures {
  poseDisplacementCurve: number[];
  wristSpeedCurve: number[];
  wristAccelerationCurve: number[];
  peakWristSpeedPxPerSec: number;
  peakWristAccelerationPxPerSec2: number;
  comPathLengthPx: number;
  comStabilityCurve: number[];
}

export interface EngagementWindow {
  startTime: number;
  endTime: number;
  peakScore: number;
}

export interface RacketActivationFeatures {
  timeline: RacketZoneSignal[];
  forehandEngagementWindows: EngagementWindow[];
  backhandCompactnessProxy: number;
  overheadServeActivation: boolean;
  maxEngagementScore: number;
}

export interface StabilityScores {
  overall: number;
  byPhase: Record<StrokePhaseLabel, number>;
}

export interface MotionCurves {
  intensity: MotionIntensityPoint[];
  wristSpeed: Array<{ time: number; value: number }>;
  comStability: Array<{ time: number; value: number }>;
}

export interface DiagnosticsSummary {
  poseSuccessRate: number;
  extractionTimeMs: number;
  hasOverheadMotion: boolean;
  strokeFamily: 'groundstroke' | 'serve_overhead' | 'unknown';
}

/** Fully JSON-serializable output contract for the AI Metrics engine. */
export interface AIReadyStrokeData {
  schemaVersion: string;
  strokeId: string;
  generatedAt: string;
  frameCount: number;
  subjectBox: StroMotionSubjectBox;
  stroke: StrokeData;
  temporalFeatures: TemporalFeatures;
  kinematicFeatures: KinematicFeatures;
  racketActivation: RacketActivationFeatures;
  stabilityScores: StabilityScores;
  motionCurves: MotionCurves;
  diagnosticsSummary: DiagnosticsSummary;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function serializeKeypoints(
  keypoints: StroMotionPoseKeypoint[] | null,
): SerializableKeypoint[] | null {
  if (!keypoints?.length) return null;
  return keypoints.map((kp) => ({
    x: round(kp.x, 2),
    y: round(kp.y, 2),
    score: round(kp.score, 3),
    name: kp.name,
  }));
}

function dominantArmLabel(
  keypoints: StroMotionPoseKeypoint[] | null,
): 'left' | 'right' | 'unknown' {
  if (!keypoints?.length) return 'unknown';
  try {
    const arm = dominantArmIndices(keypoints);
    return arm.wrist === POSE_IDX.RIGHT_WRIST ? 'right' : 'left';
  } catch {
    return 'unknown';
  }
}

function kp(
  keypoints: StroMotionPoseKeypoint[] | null,
  idx: number,
): StroMotionPoseKeypoint | null {
  if (!keypoints) return null;
  const p = keypoints[idx];
  return p && p.score >= MIN_POSE_SCORE ? p : null;
}

function centerOfMass(keypoints: StroMotionPoseKeypoint[] | null): { x: number; y: number } | null {
  const ls = kp(keypoints, POSE_IDX.LEFT_SHOULDER);
  const rs = kp(keypoints, POSE_IDX.RIGHT_SHOULDER);
  const lh = kp(keypoints, POSE_IDX.LEFT_HIP);
  const rh = kp(keypoints, POSE_IDX.RIGHT_HIP);

  const points = [ls, rs, lh, rh].filter(Boolean) as StroMotionPoseKeypoint[];
  if (points.length < 2) return null;

  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y };
}

function dominantWrist(
  keypoints: StroMotionPoseKeypoint[] | null,
): StroMotionPoseKeypoint | null {
  if (!keypoints?.length) return null;
  const arm = dominantArmIndices(keypoints);
  return kp(keypoints, arm.wrist);
}

function poseDisplacement(
  a: StroMotionPoseKeypoint[] | null,
  b: StroMotionPoseKeypoint[] | null,
): number {
  if (!a?.length || !b?.length) return 0;

  let sum = 0;
  let count = 0;
  for (let i = 5; i <= 16; i++) {
    const pa = kp(a, i);
    const pb = kp(b, i);
    if (!pa || !pb) continue;
    sum += Math.hypot(pa.x - pb.x, pa.y - pb.y);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function shoulderTiltDeg(keypoints: StroMotionPoseKeypoint[] | null): number | null {
  const ls = kp(keypoints, POSE_IDX.LEFT_SHOULDER);
  const rs = kp(keypoints, POSE_IDX.RIGHT_SHOULDER);
  if (!ls || !rs) return null;
  return (Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180) / Math.PI;
}

function hipShoulderSeparation(keypoints: StroMotionPoseKeypoint[] | null): number | null {
  const com = centerOfMass(keypoints);
  const lh = kp(keypoints, POSE_IDX.LEFT_HIP);
  const rh = kp(keypoints, POSE_IDX.RIGHT_HIP);
  if (!com || !lh || !rh) return null;
  const hipMidX = (lh.x + rh.x) / 2;
  const hipMidY = (lh.y + rh.y) / 2;
  return Math.hypot(com.x - hipMidX, com.y - hipMidY);
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function hashStrokeId(input: {
  sampleTimes: number[];
  subjectBox: StroMotionSubjectBox;
  frameCount: number;
}): string {
  const payload = JSON.stringify({
    t: input.sampleTimes.map((v) => round(v, 4)),
    b: input.subjectBox,
    n: input.frameCount,
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `stroke-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function isOverheadFrame(keypoints: StroMotionPoseKeypoint[] | null): boolean {
  if (!keypoints?.length) return false;
  const arm = dominantArmIndices(keypoints);
  const shoulder = kp(keypoints, arm.shoulder);
  const wrist = kp(keypoints, arm.wrist);
  if (!shoulder || !wrist) return false;
  return wrist.y < shoulder.y - 20;
}

function buildRacketZoneSignal(
  index: number,
  time: number,
  keypoints: StroMotionPoseKeypoint[] | null,
  vw: number,
  vh: number,
): RacketZoneSignal {
  if (!keypoints?.length) {
    return {
      index,
      time,
      zoneCount: 0,
      combinedAreaPx: 0,
      forwardHeadActive: false,
      backswingActive: false,
      overheadActive: false,
      twoHandActive: false,
      engagementScore: 0,
    };
  }

  const zones = estimateTennisRacketZones(keypoints, vw, vh);
  const overhead = isOverheadFrame(keypoints);
  const arm = dominantArmIndices(keypoints);
  const shoulder = kp(keypoints, arm.shoulder);
  const elbow = kp(keypoints, arm.elbow);
  const wrist = kp(keypoints, arm.wrist);

  let forwardHeadActive = false;
  let backswingActive = false;
  let twoHandActive = zones.zones.length >= 7;

  if (shoulder && elbow && wrist) {
    const ux = wrist.x - elbow.x;
    const uy = wrist.y - elbow.y;
    const len = Math.hypot(ux, uy) || 1;
    const headX = wrist.x + (ux / len) * len * 2.25;
    const headY = wrist.y + (uy / len) * len * 2.25;
    const backX = wrist.x - (ux / len) * len * 1.05;
    const backY = wrist.y - (uy / len) * len * 1.05;

    const bodyMidX = shoulder.x;
    forwardHeadActive = headX > bodyMidX ? arm.wrist === POSE_IDX.RIGHT_WRIST : headX < bodyMidX;
    backswingActive = Math.hypot(wrist.x - backX, wrist.y - backY) > len * 0.5;
  }

  const lw = kp(keypoints, POSE_IDX.LEFT_WRIST);
  const rw = kp(keypoints, POSE_IDX.RIGHT_WRIST);
  if (lw && rw) {
    const le = kp(keypoints, POSE_IDX.LEFT_ELBOW);
    const re = kp(keypoints, POSE_IDX.RIGHT_ELBOW);
    const forearmRef = Math.max(
      le && lw ? Math.hypot(lw.x - le.x, lw.y - le.y) : 0,
      re && rw ? Math.hypot(rw.x - re.x, rw.y - re.y) : 0,
    );
    if (forearmRef > 0 && Math.hypot(lw.x - rw.x, lw.y - rw.y) <= forearmRef * 2.2) {
      twoHandActive = true;
    }
  }

  const combinedArea = zones.combined ? pixelRectArea(zones.combined) : 0;
  const engagementScore = clamp01(
    (zones.zones.length / 8) * 0.35 +
    (combinedArea > 0 ? Math.min(1, combinedArea / 12000) : 0) * 0.35 +
    (overhead ? 0.2 : forwardHeadActive ? 0.15 : 0) +
    (twoHandActive ? 0.1 : 0),
  );

  return {
    index,
    time: round(time, 4),
    zoneCount: zones.zones.length,
    combinedAreaPx: round(combinedArea, 1),
    forwardHeadActive,
    backswingActive,
    overheadActive: overhead,
    twoHandActive,
    engagementScore: round(engagementScore, 3),
  };
}

function buildMotionIntensityCurve(
  timestamps: number[],
  poses: (StroMotionPoseKeypoint[] | null)[],
): MotionIntensityPoint[] {
  if (timestamps.length === 0) return [];

  const raw: number[] = [0];
  for (let i = 1; i < poses.length; i++) {
    raw.push(poseDisplacement(poses[i - 1], poses[i]));
  }

  const max = Math.max(...raw, 1e-6);
  return timestamps.map((time, index) => ({
    index,
    time: round(time, 4),
    intensity: round(raw[index] / max, 4),
  }));
}

function segmentPhases(
  timestamps: number[],
  intensityCurve: MotionIntensityPoint[],
  wristSpeedCurve: number[],
): PhaseSegment[] {
  const n = timestamps.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{
      phase: 'prep',
      startTime: round(timestamps[0], 4),
      endTime: round(timestamps[0], 4),
      startIndex: 0,
      endIndex: 0,
      durationSec: 0,
    }];
  }

  const peakIdx = wristSpeedCurve.reduce(
    (best, v, i) => (i > 0 && v > wristSpeedCurve[best] ? i : best),
    1,
  );
  const intensityPeakIdx = intensityCurve.reduce(
    (best, p, i) => (i > 0 && p.intensity > intensityCurve[best].intensity ? i : best),
    1,
  );
  const actionIdx = Math.round((peakIdx + intensityPeakIdx) / 2);

  const peakSpeed = wristSpeedCurve[actionIdx] || 1e-6;
  const threshold = peakSpeed * 0.25;

  let prepEnd = 0;
  for (let i = 1; i <= actionIdx; i++) {
    if (wristSpeedCurve[i] >= threshold) {
      prepEnd = i - 1;
      break;
    }
    prepEnd = i;
  }

  let followStart = n - 1;
  for (let i = actionIdx; i < n; i++) {
    if (wristSpeedCurve[i] < threshold) {
      followStart = i;
      break;
    }
  }

  prepEnd = Math.min(prepEnd, Math.max(0, actionIdx - 1));
  followStart = Math.max(followStart, Math.min(n - 1, actionIdx + 1));

  if (prepEnd >= followStart) {
    const third = Math.max(1, Math.floor(n / 3));
    prepEnd = Math.min(third - 1, n - 2);
    followStart = Math.min(n - 1, third * 2);
  }

  const swingEnd = Math.max(prepEnd + 1, Math.min(followStart - 1, n - 1));

  return [
    {
      phase: 'prep',
      startTime: round(timestamps[0], 4),
      endTime: round(timestamps[prepEnd], 4),
      startIndex: 0,
      endIndex: prepEnd,
      durationSec: round(timestamps[prepEnd] - timestamps[0], 4),
    },
    {
      phase: 'swing',
      startTime: round(timestamps[Math.min(prepEnd + 1, n - 1)], 4),
      endTime: round(timestamps[swingEnd], 4),
      startIndex: Math.min(prepEnd + 1, n - 1),
      endIndex: swingEnd,
      durationSec: round(timestamps[swingEnd] - timestamps[Math.min(prepEnd + 1, n - 1)], 4),
    },
    {
      phase: 'follow_through',
      startTime: round(timestamps[Math.min(followStart, n - 1)], 4),
      endTime: round(timestamps[n - 1], 4),
      startIndex: Math.min(followStart, n - 1),
      endIndex: n - 1,
      durationSec: round(timestamps[n - 1] - timestamps[Math.min(followStart, n - 1)], 4),
    },
  ];
}

function computeKinematics(
  timestamps: number[],
  poses: (StroMotionPoseKeypoint[] | null)[],
): {
  poseDisplacementCurve: number[];
  wristSpeedCurve: number[];
  wristAccelerationCurve: number[];
  peakWristSpeedPxPerSec: number;
  peakWristAccelerationPxPerSec2: number;
  comPathLengthPx: number;
  comStabilityCurve: number[];
} {
  const n = poses.length;
  const poseDisplacementCurve: number[] = [];
  const wristSpeedCurve: number[] = [0];
  const wristAccelerationCurve: number[] = [0];
  const comStabilityCurve: number[] = [0];

  let comPathLengthPx = 0;
  let prevCom: { x: number; y: number } | null = null;
  let prevWrist: StroMotionPoseKeypoint | null = null;
  let prevWristSpeed = 0;

  for (let i = 0; i < n; i++) {
    poseDisplacementCurve.push(
      i === 0 ? 0 : round(poseDisplacement(poses[i - 1], poses[i]), 3),
    );

    const com = centerOfMass(poses[i]);
    if (com && prevCom) {
      const delta = Math.hypot(com.x - prevCom.x, com.y - prevCom.y);
      comPathLengthPx += delta;
      comStabilityCurve.push(round(delta, 3));
    } else if (i > 0) {
      comStabilityCurve.push(0);
    }
    prevCom = com;

    const wrist = dominantWrist(poses[i]);
    if (i === 0 || !wrist || !prevWrist) {
      if (i > 0) {
        wristSpeedCurve.push(0);
        wristAccelerationCurve.push(0);
      }
    } else {
      const dt = Math.max(1e-3, timestamps[i] - timestamps[i - 1]);
      const speed = Math.hypot(wrist.x - prevWrist.x, wrist.y - prevWrist.y) / dt;
      wristSpeedCurve.push(round(speed, 2));
      wristAccelerationCurve.push(round((speed - prevWristSpeed) / dt, 2));
      prevWristSpeed = speed;
    }
    prevWrist = wrist;
  }

  return {
    poseDisplacementCurve,
    wristSpeedCurve,
    wristAccelerationCurve,
    peakWristSpeedPxPerSec: round(Math.max(...wristSpeedCurve, 0), 2),
    peakWristAccelerationPxPerSec2: round(Math.max(...wristAccelerationCurve, 0), 2),
    comPathLengthPx: round(comPathLengthPx, 2),
    comStabilityCurve,
  };
}

function computeStabilityForPhase(
  phase: StrokePhaseLabel,
  segments: PhaseSegment[],
  poses: (StroMotionPoseKeypoint[] | null)[],
): StabilityMetrics {
  const segment = segments.find((s) => s.phase === phase);
  if (!segment) {
    return {
      phase,
      comJitterPx: 0,
      shoulderTiltStdDeg: 0,
      hipShoulderSeparationStd: 0,
      score: 0,
    };
  }

  const comDeltas: number[] = [];
  const tilts: number[] = [];
  const separations: number[] = [];

  for (let i = segment.startIndex; i <= segment.endIndex; i++) {
    const tilt = shoulderTiltDeg(poses[i]);
    if (tilt !== null) tilts.push(tilt);
    const sep = hipShoulderSeparation(poses[i]);
    if (sep !== null) separations.push(sep);
    if (i > segment.startIndex) {
      const c0 = centerOfMass(poses[i - 1]);
      const c1 = centerOfMass(poses[i]);
      if (c0 && c1) comDeltas.push(Math.hypot(c1.x - c0.x, c1.y - c0.y));
    }
  }

  const comJitterPx = round(stdDev(comDeltas), 3);
  const shoulderTiltStdDeg = round(stdDev(tilts), 3);
  const hipShoulderSeparationStd = round(stdDev(separations), 3);

  const jitterNorm = clamp01(1 - comJitterPx / 40);
  const tiltNorm = clamp01(1 - shoulderTiltStdDeg / 25);
  const sepNorm = clamp01(1 - hipShoulderSeparationStd / 30);
  const score = round((jitterNorm * 0.4 + tiltNorm * 0.35 + sepNorm * 0.25) * 100, 1);

  return {
    phase,
    comJitterPx,
    shoulderTiltStdDeg,
    hipShoulderSeparationStd,
    score,
  };
}

function buildForehandEngagementWindows(
  timeline: RacketZoneSignal[],
): EngagementWindow[] {
  const windows: EngagementWindow[] = [];
  let start: number | null = null;
  let peak = 0;

  for (const signal of timeline) {
    if (signal.forwardHeadActive && signal.engagementScore >= 0.35) {
      if (start === null) start = signal.time;
      peak = Math.max(peak, signal.engagementScore);
    } else if (start !== null) {
      windows.push({
        startTime: round(start, 4),
        endTime: round(signal.time, 4),
        peakScore: round(peak, 3),
      });
      start = null;
      peak = 0;
    }
  }

  if (start !== null && timeline.length > 0) {
    const last = timeline[timeline.length - 1];
    windows.push({
      startTime: round(start, 4),
      endTime: round(last.time, 4),
      peakScore: round(peak, 3),
    });
  }

  return windows;
}

function computeBackhandCompactnessProxy(
  poses: (StroMotionPoseKeypoint[] | null)[],
): number {
  const samples: number[] = [];

  for (const pose of poses) {
    if (!pose?.length) continue;
    const lw = kp(pose, POSE_IDX.LEFT_WRIST);
    const rw = kp(pose, POSE_IDX.RIGHT_WRIST);
    const ls = kp(pose, POSE_IDX.LEFT_SHOULDER);
    const rs = kp(pose, POSE_IDX.RIGHT_SHOULDER);
    if (!lw || !rw || !ls || !rs) continue;

    const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y) || 1;
    const wristSpan = Math.hypot(rw.x - lw.x, rw.y - lw.y);
    samples.push(wristSpan / shoulderWidth);
  }

  if (samples.length === 0) return 0;
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  return round(clamp01(1 - avg / 2.5), 3);
}

function detectStrokeFamily(
  poses: (StroMotionPoseKeypoint[] | null)[],
  serveStress: StroMotionResult['diagnostics']['serveStress'],
): 'groundstroke' | 'serve_overhead' | 'unknown' {
  const overheadFrames = poses.filter((p) => isOverheadFrame(p)).length;
  const servePhases = serveStress.filter((f) => f.phase !== 'groundstroke').length;

  if (servePhases >= 2 || overheadFrames >= Math.ceil(poses.length * 0.35)) {
    return 'serve_overhead';
  }
  if (poses.some(Boolean)) return 'groundstroke';
  return 'unknown';
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Transform a StroMotion composite result into JSON-serializable biomechanical data.
 * Does not read ImageBitmap pixels — only metadata, poses, times, and diagnostics.
 */
export function buildStrokeAnalytics(result: StroMotionResult): AIReadyStrokeData {
  const { sampleTimes, ghostPoses, subjectBox, diagnostics, ghostLayers } = result;
  const frameCount = ghostLayers.length;
  const vw = result.baseFrame.width;
  const vh = result.baseFrame.height;

  const strokeId = hashStrokeId({ sampleTimes, subjectBox, frameCount });

  const poseEvolution: PoseSnapshot[] = sampleTimes.map((time, index) => ({
    index,
    time: round(time, 4),
    keypoints: serializeKeypoints(ghostPoses[index] ?? null),
    dominantArm: dominantArmLabel(ghostPoses[index] ?? null),
  }));

  const racketZoneTimeline: RacketZoneSignal[] = sampleTimes.map((time, index) =>
    buildRacketZoneSignal(index, time, ghostPoses[index] ?? null, vw, vh),
  );

  const motionIntensityCurve = buildMotionIntensityCurve(sampleTimes, ghostPoses);
  const kinematics = computeKinematics(sampleTimes, ghostPoses);
  const phases = segmentPhases(sampleTimes, motionIntensityCurve, kinematics.wristSpeedCurve);

  const stabilityByPhase = (['prep', 'swing', 'follow_through'] as StrokePhaseLabel[]).map(
    (phase) => computeStabilityForPhase(phase, phases, ghostPoses),
  );

  const stroke: StrokeData = {
    strokeId,
    timestamps: sampleTimes.map((t) => round(t, 4)),
    phases,
    poseEvolution,
    racketZoneTimeline,
    motionIntensityCurve,
    stabilityByPhase,
  };

  const totalDurationSec = sampleTimes.length > 1
    ? round(sampleTimes[sampleTimes.length - 1] - sampleTimes[0], 4)
    : 0;

  const phaseDurations: Record<StrokePhaseLabel, number> = {
    prep: 0,
    swing: 0,
    follow_through: 0,
  };
  for (const seg of phases) {
    phaseDurations[seg.phase] = round(seg.durationSec, 4);
  }

  const phaseTimeRatios: Record<StrokePhaseLabel, number> = {
    prep: totalDurationSec > 0 ? round(phaseDurations.prep / totalDurationSec, 4) : 0,
    swing: totalDurationSec > 0 ? round(phaseDurations.swing / totalDurationSec, 4) : 0,
    follow_through: totalDurationSec > 0
      ? round(phaseDurations.follow_through / totalDurationSec, 4)
      : 0,
  };

  const temporalFeatures: TemporalFeatures = {
    totalDurationSec,
    phaseDurations,
    phaseTimeRatios,
    prepToSwingRatio: phaseDurations.swing > 0
      ? round(phaseDurations.prep / phaseDurations.swing, 4)
      : 0,
    swingToFollowRatio: phaseDurations.follow_through > 0
      ? round(phaseDurations.swing / phaseDurations.follow_through, 4)
      : 0,
  };

  const forehandEngagementWindows = buildForehandEngagementWindows(racketZoneTimeline);
  const backhandCompactnessProxy = computeBackhandCompactnessProxy(ghostPoses);
  const overheadServeActivation = racketZoneTimeline.some((s) => s.overheadActive);

  const racketActivation: RacketActivationFeatures = {
    timeline: racketZoneTimeline,
    forehandEngagementWindows,
    backhandCompactnessProxy,
    overheadServeActivation,
    maxEngagementScore: round(
      Math.max(...racketZoneTimeline.map((s) => s.engagementScore), 0),
      3,
    ),
  };

  const byPhase: Record<StrokePhaseLabel, number> = {
    prep: stabilityByPhase.find((s) => s.phase === 'prep')?.score ?? 0,
    swing: stabilityByPhase.find((s) => s.phase === 'swing')?.score ?? 0,
    follow_through: stabilityByPhase.find((s) => s.phase === 'follow_through')?.score ?? 0,
  };

  const stabilityScores: StabilityScores = {
    overall: round(
      (byPhase.prep + byPhase.swing + byPhase.follow_through) / 3,
      1,
    ),
    byPhase,
  };

  const motionCurves: MotionCurves = {
    intensity: motionIntensityCurve,
    wristSpeed: sampleTimes.map((time, i) => ({
      time: round(time, 4),
      value: kinematics.wristSpeedCurve[i] ?? 0,
    })),
    comStability: sampleTimes.map((time, i) => ({
      time: round(time, 4),
      value: kinematics.comStabilityCurve[i] ?? 0,
    })),
  };

  const strokeFamily = detectStrokeFamily(ghostPoses, diagnostics.serveStress);

  return {
    schemaVersion: STRO_ANALYTICS_SCHEMA_VERSION,
    strokeId,
    generatedAt: new Date().toISOString(),
    frameCount,
    subjectBox: {
      x: round(subjectBox.x, 5),
      y: round(subjectBox.y, 5),
      width: round(subjectBox.width, 5),
      height: round(subjectBox.height, 5),
    },
    stroke,
    temporalFeatures,
    kinematicFeatures: {
      poseDisplacementCurve: kinematics.poseDisplacementCurve,
      wristSpeedCurve: kinematics.wristSpeedCurve,
      wristAccelerationCurve: kinematics.wristAccelerationCurve,
      peakWristSpeedPxPerSec: kinematics.peakWristSpeedPxPerSec,
      peakWristAccelerationPxPerSec2: kinematics.peakWristAccelerationPxPerSec2,
      comPathLengthPx: kinematics.comPathLengthPx,
      comStabilityCurve: kinematics.comStabilityCurve,
    },
    racketActivation,
    stabilityScores,
    motionCurves,
    diagnosticsSummary: {
      poseSuccessRate: round(diagnostics.poseSuccessRate, 2),
      extractionTimeMs: diagnostics.extractionTimeMs,
      hasOverheadMotion: overheadServeActivation,
      strokeFamily,
    },
  };
}
