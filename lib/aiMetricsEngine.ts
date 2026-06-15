/**
 * AI Metrics Interpretation Layer — transforms AIReadyStrokeData into coaching metrics.
 * Does not modify StroMotion or stroMotionAnalytics. No ML — rule-based reconciliation.
 */

import type { AIReadyStrokeData } from '@/lib/stroMotionAnalytics';

export const AI_METRICS_SCHEMA_VERSION = '1.0.0';

// ─── Output schema ───────────────────────────────────────────────────────────

export type NormalizedPhaseLabel =
  | 'preparation'
  | 'acceleration'
  | 'contact'
  | 'follow_through';

export interface MetricWithConfidence {
  value: number;
  confidence: number;
}

export interface NormalizedPhaseSegment {
  phase: NormalizedPhaseLabel;
  startTime: number;
  endTime: number;
  startIndex: number;
  endIndex: number;
  durationSec: number;
}

export interface InferredContactWindow {
  startTime: number;
  endTime: number;
  peakTime: number;
  peakProbability: number;
  confidence: number;
}

export interface CorrectedPhaseModel {
  normalizedPhaseTimeline: NormalizedPhaseSegment[];
  inferredContactWindow: InferredContactWindow;
  coversFullTimeline: boolean;
}

export interface TimeSeriesPoint {
  time: number;
  value: number;
}

export interface ContactProbabilityPoint {
  time: number;
  probability: number;
}

export interface ReconciledFeatures {
  /** Derived from COM displacement — higher = more frame-to-frame body movement. */
  movementVariabilityIndex: TimeSeriesPoint[];
  /** Inferred contact likelihood — not raw racket engagement. */
  contactProbabilityCurve: ContactProbabilityPoint[];
  smoothedIntensity: TimeSeriesPoint[];
  smoothedWristSpeed: TimeSeriesPoint[];
}

export interface BiomechanicalScores {
  preparation_score: MetricWithConfidence;
  kinetic_chain_score: MetricWithConfidence;
  swing_path_score: MetricWithConfidence;
  contact_quality_score: MetricWithConfidence;
  timing_score: MetricWithConfidence;
}

export interface SignalQualityAssessment {
  poseCompleteness: number;
  signalConsistency: number;
  phaseClarity: number;
  curveSmoothness: number;
}

export interface AIMetricsResult {
  schemaVersion: string;
  strokeId: string;
  strokeFamily: AIReadyStrokeData['diagnosticsSummary']['strokeFamily'];
  scores: BiomechanicalScores;
  correctedPhases: CorrectedPhaseModel;
  reconciledFeatures: ReconciledFeatures;
  signalQuality: SignalQualityAssessment;
  overallConfidence: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round(n: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampScore(n: number): number {
  return round(Math.max(0, Math.min(100, n)), 1);
}

function normalizeSeries(values: number[]): number[] {
  const max = Math.max(...values, 1e-6);
  return values.map((v) => round(v / max, 4));
}

function smooth3(values: number[]): number[] {
  if (values.length <= 2) return values.map((v) => round(v, 4));
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length - 1; i++) {
    out.push(round((values[i - 1] + values[i] + values[i + 1]) / 3, 4));
  }
  out.push(values[values.length - 1]);
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const mx = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = a[i] - mx;
    const vy = b[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function indexAtTime(times: number[], t: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function computePoseCompleteness(data: AIReadyStrokeData): number {
  const rate = data.diagnosticsSummary.poseSuccessRate / 100;
  const withPose = data.stroke.poseEvolution.filter((p) => p.keypoints?.length).length;
  const frameRate = data.frameCount > 0 ? withPose / data.frameCount : 0;
  return clamp01(rate * 0.6 + frameRate * 0.4);
}

function buildActionSignal(data: AIReadyStrokeData): number[] {
  const intensity = data.motionCurves.intensity.map((p) => p.intensity);
  const wrist = data.motionCurves.wristSpeed.map((p) => p.value);
  const ni = normalizeSeries(intensity);
  const nw = normalizeSeries(wrist);
  const raw = ni.map((v, i) => round(v * 0.45 + (nw[i] ?? 0) * 0.55, 4));
  return smooth3(raw);
}

function buildContactProbabilityCurve(data: AIReadyStrokeData): ContactProbabilityPoint[] {
  const times = data.stroke.timestamps;
  const intensity = normalizeSeries(data.motionCurves.intensity.map((p) => p.intensity));
  const wrist = normalizeSeries(data.motionCurves.wristSpeed.map((p) => p.value));
  const accel = normalizeSeries(
    data.kinematicFeatures.wristAccelerationCurve.map((v) => Math.max(0, v)),
  );
  const racket = data.racketActivation.timeline;

  const raw = times.map((time, i) => {
    const forwardBoost = racket[i]?.forwardHeadActive ? 0.12 : 0;
    const overheadBoost = racket[i]?.overheadActive ? 0.08 : 0;
    const engagementHint = clamp01((racket[i]?.engagementScore ?? 0) * 0.15);
    const combined =
      intensity[i] * 0.3 +
      wrist[i] * 0.35 +
      accel[i] * 0.2 +
      forwardBoost +
      overheadBoost +
      engagementHint;
    return combined;
  });

  const smoothed = smooth3(raw);
  const max = Math.max(...smoothed, 1e-6);
  return times.map((time, i) => ({
    time: round(time, 4),
    probability: round(smoothed[i] / max, 4),
  }));
}

function buildMovementVariabilityIndex(data: AIReadyStrokeData): TimeSeriesPoint[] {
  const times = data.stroke.timestamps;
  const comRaw = data.motionCurves.comStability.map((p) => p.value);
  const smoothed = smooth3(comRaw);
  const max = Math.max(...smoothed, 1e-6);
  return times.map((time, i) => ({
    time: round(time, 4),
    value: round(smoothed[i] / max, 4),
  }));
}

function findContactPeak(contactCurve: ContactProbabilityPoint[]): number {
  if (contactCurve.length === 0) return 0;
  let peak = 0;
  for (let i = 1; i < contactCurve.length - 1; i++) {
    if (contactCurve[i].probability >= contactCurve[peak].probability) peak = i;
  }
  return peak;
}

function buildCorrectedPhaseModel(
  data: AIReadyStrokeData,
  actionSignal: number[],
  contactCurve: ContactProbabilityPoint[],
): CorrectedPhaseModel {
  const times = data.stroke.timestamps;
  const n = times.length;

  if (n === 0) {
    return {
      normalizedPhaseTimeline: [],
      inferredContactWindow: {
        startTime: 0,
        endTime: 0,
        peakTime: 0,
        peakProbability: 0,
        confidence: 0,
      },
      coversFullTimeline: false,
    };
  }

  if (n === 1) {
    return {
      normalizedPhaseTimeline: [{
        phase: 'contact',
        startTime: round(times[0], 4),
        endTime: round(times[0], 4),
        startIndex: 0,
        endIndex: 0,
        durationSec: 0,
      }],
      inferredContactWindow: {
        startTime: round(times[0], 4),
        endTime: round(times[0], 4),
        peakTime: round(times[0], 4),
        peakProbability: contactCurve[0]?.probability ?? 0,
        confidence: 0.3,
      },
      coversFullTimeline: true,
    };
  }

  const peakIdx = findContactPeak(contactCurve);
  const peakProb = contactCurve[peakIdx]?.probability ?? 0;
  const peakTime = times[peakIdx];
  const threshold = Math.max(0.2, peakProb * 0.55);

  let contactStartIdx = peakIdx;
  let contactEndIdx = peakIdx;
  for (let i = peakIdx; i >= 0; i--) {
    if (contactCurve[i].probability >= threshold) contactStartIdx = i;
    else break;
  }
  for (let i = peakIdx; i < n; i++) {
    if (contactCurve[i].probability >= threshold) contactEndIdx = i;
    else break;
  }

  let prepEndIdx = 0;
  for (let i = 0; i < contactStartIdx; i++) {
    if (actionSignal[i] >= threshold * 0.45) {
      prepEndIdx = Math.max(0, i - 1);
      break;
    }
    prepEndIdx = i;
  }
  prepEndIdx = Math.min(prepEndIdx, Math.max(0, contactStartIdx - 1));

  const partitions: Array<{ phase: NormalizedPhaseLabel; start: number; end: number }> = [];

  if (prepEndIdx >= 0) {
    partitions.push({ phase: 'preparation', start: 0, end: prepEndIdx });
  }

  const accelStart = prepEndIdx + 1;
  const accelEnd = contactStartIdx - 1;
  if (accelStart <= accelEnd) {
    partitions.push({ phase: 'acceleration', start: accelStart, end: accelEnd });
  }

  partitions.push({ phase: 'contact', start: contactStartIdx, end: contactEndIdx });

  const followStart = contactEndIdx + 1;
  if (followStart < n) {
    partitions.push({ phase: 'follow_through', start: followStart, end: n - 1 });
  }

  const merged = applyContinuousPhaseTiming(
    partitions.map((p) => ({
      phase: p.phase,
      startTime: round(times[p.start], 4),
      endTime: round(times[p.end], 4),
      startIndex: p.start,
      endIndex: p.end,
      durationSec: round(times[p.end] - times[p.start], 4),
    })),
    times,
  );
  const coversFullTimeline = verifyFullCoverage(merged, times);

  const contactPhase = merged.find((p) => p.phase === 'contact');
  const windowWidth = contactPhase
    ? contactPhase.endTime - contactPhase.startTime
    : 0;
  const contactConfidence = clamp01(
    peakProb * 0.5 +
    (windowWidth > 0 ? 0.2 : 0.1) +
    (peakIdx > 0 && peakIdx < n - 1 ? 0.2 : 0.05),
  );

  return {
    normalizedPhaseTimeline: merged,
    inferredContactWindow: {
      startTime: contactPhase?.startTime ?? round(times[contactStartIdx], 4),
      endTime: contactPhase?.endTime ?? round(times[contactEndIdx], 4),
      peakTime: round(peakTime, 4),
      peakProbability: round(peakProb, 4),
      confidence: round(contactConfidence, 3),
    },
    coversFullTimeline,
  };
}

/** Map index partitions to continuous time so phase durations sum to full stroke length. */
function applyContinuousPhaseTiming(
  segments: NormalizedPhaseSegment[],
  times: number[],
): NormalizedPhaseSegment[] {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1) {
    return segments.map((s) => ({
      ...s,
      startTime: round(times[0], 4),
      endTime: round(times[0], 4),
      durationSec: 0,
    }));
  }

  const mid = (i: number) => round((times[i] + times[i + 1]) / 2, 4);
  const phaseStartTime = (startIndex: number) =>
    startIndex === 0 ? round(times[0], 4) : mid(startIndex - 1);
  const phaseEndTime = (endIndex: number) =>
    endIndex === n - 1 ? round(times[n - 1], 4) : mid(endIndex);

  return segments.map((s) => {
    const startTime = phaseStartTime(s.startIndex);
    const endTime = phaseEndTime(s.endIndex);
    return {
      ...s,
      startTime,
      endTime,
      durationSec: round(Math.max(0, endTime - startTime), 4),
    };
  });
}

function verifyFullCoverage(segments: NormalizedPhaseSegment[], times: number[]): boolean {
  if (times.length === 0) return false;
  const covered = new Set<number>();
  for (const s of segments) {
    for (let i = s.startIndex; i <= s.endIndex; i++) covered.add(i);
  }
  for (let i = 0; i < times.length; i++) {
    if (!covered.has(i)) return false;
  }
  const totalDur = round(times[times.length - 1] - times[0], 4);
  const sumDur = round(segments.reduce((s, seg) => s + seg.durationSec, 0), 4);
  return Math.abs(sumDur - totalDur) < 0.02;
}

function assessSignalQuality(
  data: AIReadyStrokeData,
  actionSignal: number[],
  contactCurve: ContactProbabilityPoint[],
): SignalQualityAssessment {
  const intensity = data.motionCurves.intensity.map((p) => p.intensity);
  const wrist = data.motionCurves.wristSpeed.map((p) => p.value);

  const poseCompleteness = computePoseCompleteness(data);
  const signalConsistency = clamp01((pearson(intensity, wrist) + 1) / 2);

  const peak = Math.max(...contactCurve.map((p) => p.probability), 0);
  const mean = contactCurve.reduce((s, p) => s + p.probability, 0) / Math.max(1, contactCurve.length);
  const phaseClarity = clamp01(peak > 0 ? (peak - mean) / peak : 0);

  const diffs = actionSignal.slice(1).map((v, i) => Math.abs(v - actionSignal[i]));
  const avgDiff = diffs.reduce((s, v) => s + v, 0) / Math.max(1, diffs.length);
  const curveSmoothness = clamp01(1 - avgDiff * 2);

  return {
    poseCompleteness: round(poseCompleteness, 3),
    signalConsistency: round(signalConsistency, 3),
    phaseClarity: round(phaseClarity, 3),
    curveSmoothness: round(curveSmoothness, 3),
  };
}

function metricConfidence(
  quality: SignalQualityAssessment,
  specific: number,
): number {
  return round(
    clamp01(
      quality.poseCompleteness * 0.3 +
      quality.signalConsistency * 0.25 +
      quality.phaseClarity * 0.25 +
      quality.curveSmoothness * 0.1 +
      specific * 0.1,
    ),
    3,
  );
}

function scorePreparation(
  data: AIReadyStrokeData,
  phases: NormalizedPhaseSegment[],
  variability: TimeSeriesPoint[],
  quality: SignalQualityAssessment,
): MetricWithConfidence {
  const prep = phases.find((p) => p.phase === 'preparation');
  if (!prep) {
    return { value: 50, confidence: metricConfidence(quality, 0.2) };
  }

  const prepVar = variability
    .filter((v) => v.time >= prep.startTime && v.time <= prep.endTime)
    .map((v) => v.value);
  const avgVar = prepVar.length
    ? prepVar.reduce((s, v) => s + v, 0) / prepVar.length
    : 0.5;

  const lowMotionScore = clamp01(1 - avgVar) * 100;
  const durationRatio = data.temporalFeatures.totalDurationSec > 0
    ? prep.durationSec / data.temporalFeatures.totalDurationSec
    : 0;
  const durationScore = clamp01(durationRatio / 0.45) * 100;

  const value = clampScore(lowMotionScore * 0.65 + durationScore * 0.35);
  return { value, confidence: metricConfidence(quality, clamp01(1 - avgVar)) };
}

function scoreKineticChain(
  data: AIReadyStrokeData,
  actionSignal: number[],
  contactWindow: InferredContactWindow,
  quality: SignalQualityAssessment,
): MetricWithConfidence {
  const peakIdx = indexAtTime(data.stroke.timestamps, contactWindow.peakTime);
  const n = actionSignal.length;

  let buildup = 0;
  for (let i = 1; i <= peakIdx; i++) {
    if (actionSignal[i] >= actionSignal[i - 1]) buildup++;
  }
  const buildupRatio = peakIdx > 0 ? buildup / peakIdx : 0;

  const postPeak = actionSignal.slice(peakIdx + 1);
  let decay = 0;
  for (let i = 1; i < postPeak.length; i++) {
    if (postPeak[i] <= postPeak[i - 1]) decay++;
  }
  const decayRatio = postPeak.length > 1 ? decay / (postPeak.length - 1) : 0.5;

  const peakAccel = data.kinematicFeatures.peakWristAccelerationPxPerSec2;
  const accelNorm = clamp01(peakAccel / 800);

  const value = clampScore(
    buildupRatio * 40 + decayRatio * 25 + accelNorm * 35,
  );
  const specific = clamp01(buildupRatio * 0.5 + (n > 2 ? 0.3 : 0.1));
  return { value, confidence: metricConfidence(quality, specific) };
}

function scoreSwingPath(
  data: AIReadyStrokeData,
  smoothedWrist: TimeSeriesPoint[],
  quality: SignalQualityAssessment,
): MetricWithConfidence {
  const speeds = smoothedWrist.map((p) => p.value);
  if (speeds.length < 2) {
    return { value: 50, confidence: metricConfidence(quality, 0.2) };
  }

  const diffs = speeds.slice(1).map((v, i) => Math.abs(v - speeds[i]));
  const jerk = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const smoothness = clamp01(1 - jerk * 1.5);

  const displacement = data.kinematicFeatures.poseDisplacementCurve;
  const pathConsistency = displacement.length > 1
    ? clamp01(1 - stdDev(displacement) / (Math.max(...displacement, 1) || 1))
    : 0.5;

  const value = clampScore(smoothness * 55 + pathConsistency * 45);
  return { value, confidence: metricConfidence(quality, smoothness) };
}

function scoreContactQuality(
  contactWindow: InferredContactWindow,
  contactCurve: ContactProbabilityPoint[],
  quality: SignalQualityAssessment,
): MetricWithConfidence {
  const peak = contactWindow.peakProbability;
  const sharpness = computePeakSharpness(contactCurve);
  const centerValid = contactWindow.peakTime > 0 ? 1 : 0;

  const value = clampScore(
    peak * 45 + sharpness * 40 + centerValid * 15,
  );
  return {
    value,
    confidence: round(
      clamp01(contactWindow.confidence * 0.6 + quality.phaseClarity * 0.4),
      3,
    ),
  };
}

function scoreTiming(
  data: AIReadyStrokeData,
  phases: NormalizedPhaseSegment[],
  quality: SignalQualityAssessment,
): MetricWithConfidence {
  const total = data.temporalFeatures.totalDurationSec;
  if (total <= 0 || phases.length === 0) {
    return { value: 50, confidence: metricConfidence(quality, 0.2) };
  }

  const prep = phases.find((p) => p.phase === 'preparation')?.durationSec ?? 0;
  const accel = phases.find((p) => p.phase === 'acceleration')?.durationSec ?? 0;
  const contact = phases.find((p) => p.phase === 'contact')?.durationSec ?? 0;
  const follow = phases.find((p) => p.phase === 'follow_through')?.durationSec ?? 0;

  const isServe = data.diagnosticsSummary.strokeFamily === 'serve_overhead';
  const ideal = isServe
    ? { prep: 0.35, accel: 0.25, contact: 0.15, follow: 0.25 }
    : { prep: 0.4, accel: 0.2, contact: 0.1, follow: 0.3 };

  const actual = {
    prep: prep / total,
    accel: accel / total,
    contact: contact / total,
    follow: follow / total,
  };

  const deviation =
    Math.abs(actual.prep - ideal.prep) +
    Math.abs(actual.accel - ideal.accel) +
    Math.abs(actual.contact - ideal.contact) +
    Math.abs(actual.follow - ideal.follow);

  const value = clampScore(clamp01(1 - deviation / 1.2) * 100);
  return { value, confidence: metricConfidence(quality, clamp01(1 - deviation)) };
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function computePeakSharpness(curve: ContactProbabilityPoint[]): number {
  if (curve.length < 3) return 0.3;
  const peakIdx = findContactPeak(curve);
  const peak = curve[peakIdx].probability;
  const left = curve[Math.max(0, peakIdx - 1)].probability;
  const right = curve[Math.min(curve.length - 1, peakIdx + 1)].probability;
  const avgNeighbor = (left + right) / 2;
  return clamp01(peak > 0 ? (peak - avgNeighbor) / peak : 0);
}

function buildReconciledFeatures(
  data: AIReadyStrokeData,
  contactCurve: ContactProbabilityPoint[],
): ReconciledFeatures {
  const times = data.stroke.timestamps;
  const intensityRaw = data.motionCurves.intensity.map((p) => p.intensity);
  const wristRaw = data.motionCurves.wristSpeed.map((p) => p.value);

  return {
    movementVariabilityIndex: buildMovementVariabilityIndex(data),
    contactProbabilityCurve: contactCurve,
    smoothedIntensity: times.map((time, i) => ({
      time: round(time, 4),
      value: smooth3(intensityRaw)[i] ?? 0,
    })),
    smoothedWristSpeed: times.map((time, i) => ({
      time: round(time, 4),
      value: smooth3(wristRaw)[i] ?? 0,
    })),
  };
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Interpret validated StroMotion analytics into coaching-ready AI metrics.
 * Reconciles weak upstream signals; does not trust raw phase or engagement proxies.
 */
export function buildAIMetrics(data: AIReadyStrokeData): AIMetricsResult {
  const actionSignal = buildActionSignal(data);
  const contactCurve = buildContactProbabilityCurve(data);
  const correctedPhases = buildCorrectedPhaseModel(data, actionSignal, contactCurve);
  const reconciledFeatures = buildReconciledFeatures(data, contactCurve);
  const signalQuality = assessSignalQuality(data, actionSignal, contactCurve);

  const overallConfidence = round(
    (signalQuality.poseCompleteness +
      signalQuality.signalConsistency +
      signalQuality.phaseClarity +
      signalQuality.curveSmoothness) / 4,
    3,
  );

  const scores: BiomechanicalScores = {
    preparation_score: scorePreparation(
      data,
      correctedPhases.normalizedPhaseTimeline,
      reconciledFeatures.movementVariabilityIndex,
      signalQuality,
    ),
    kinetic_chain_score: scoreKineticChain(
      data,
      actionSignal,
      correctedPhases.inferredContactWindow,
      signalQuality,
    ),
    swing_path_score: scoreSwingPath(
      data,
      reconciledFeatures.smoothedWristSpeed,
      signalQuality,
    ),
    contact_quality_score: scoreContactQuality(
      correctedPhases.inferredContactWindow,
      contactCurve,
      signalQuality,
    ),
    timing_score: scoreTiming(
      data,
      correctedPhases.normalizedPhaseTimeline,
      signalQuality,
    ),
  };

  return {
    schemaVersion: AI_METRICS_SCHEMA_VERSION,
    strokeId: data.strokeId,
    strokeFamily: data.diagnosticsSummary.strokeFamily,
    scores,
    correctedPhases,
    reconciledFeatures,
    signalQuality,
    overallConfidence,
  };
}
