import {
  getPhaseDefinitions,
  PHASE_TEMPLATE_RATIOS,
} from '@/lib/biomechanics/strokePhases';
import type { PhaseDefinition, PhaseMarker, PoseSample, StrokeType } from '@/lib/biomechanics/types';

const MIN_SCORE = 0.2;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function wristSpeed(samples: PoseSample[]): number[] {
  const speeds = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].keypoints;
    const b = samples[i].keypoints;
    const dt = samples[i].timeSec - samples[i - 1].timeSec;
    if (!a || !b || dt <= 0) {
      speeds.push(0);
      continue;
    }
    const rw = b[10]?.score >= MIN_SCORE ? b[10] : b[9]?.score >= MIN_SCORE ? b[9] : null;
    const rwPrev = a[10]?.score >= MIN_SCORE ? a[10] : a[9]?.score >= MIN_SCORE ? a[9] : null;
    if (!rw || !rwPrev) {
      speeds.push(0);
      continue;
    }
    speeds.push(Math.hypot(rw.x - rwPrev.x, rw.y - rwPrev.y) / dt);
  }
  return speeds;
}

function templateRatioForPhase(
  phaseId: string,
  strokeType: StrokeType,
  defs: PhaseDefinition[],
): number {
  if (phaseId in PHASE_TEMPLATE_RATIOS) {
    return PHASE_TEMPLATE_RATIOS[phaseId];
  }
  const idx = defs.findIndex((d) => d.id === phaseId);
  if (idx < 0) return 0.5;
  return clamp((idx + 1) / (defs.length + 1), 0.05, 0.95);
}

function findContactPeakIndex(samples: PoseSample[], trimStart: number, trimEnd: number): number {
  if (samples.length === 0) return 0;
  const speeds = wristSpeed(samples);
  let peak = 0;
  let peakVal = -1;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].timeSec;
    if (t < trimStart || t > trimEnd) continue;
    if (speeds[i] > peakVal) {
      peakVal = speeds[i];
      peak = i;
    }
  }
  return peak;
}

function timeAtRatio(trimStart: number, trimEnd: number, ratio: number): number {
  return trimStart + (trimEnd - trimStart) * clamp(ratio, 0, 1);
}

function snapToSample(samples: PoseSample[], targetTime: number): number {
  if (samples.length === 0) return targetTime;
  let best = samples[0].timeSec;
  let bestD = Infinity;
  for (const s of samples) {
    const d = Math.abs(s.timeSec - targetTime);
    if (d < bestD) {
      bestD = d;
      best = s.timeSec;
    }
  }
  return best;
}

/** Propose phase marker times — coach must verify/adjust. */
export function proposePhaseMarkers(
  strokeType: StrokeType,
  samples: PoseSample[],
  trimStartSec: number,
  trimEndSec: number,
  customSteps?: PhaseDefinition[],
): PhaseMarker[] {
  const defs = getPhaseDefinitions(strokeType, customSteps);
  if (defs.length === 0 || trimEndSec <= trimStartSec) return [];

  const inRange = samples.filter(
    (s) => s.timeSec >= trimStartSec - 0.001 && s.timeSec <= trimEndSec + 0.001,
  );
  const hasContactStep = defs.some((d) => d.id === 'contact');
  const contactPeakIdx = findContactPeakIndex(inRange, trimStartSec, trimEndSec);
  const contactTime = inRange[contactPeakIdx]?.timeSec
    ?? timeAtRatio(trimStartSec, trimEndSec, 0.68);

  const markers: PhaseMarker[] = [];

  for (const def of defs) {
    let targetTime: number;
    if (def.id === 'contact' && hasContactStep) {
      targetTime = contactTime;
    } else if (strokeType === 'custom') {
      const idx = defs.findIndex((d) => d.id === def.id);
      const ratio = (idx + 1) / (defs.length + 1);
      targetTime = timeAtRatio(trimStartSec, trimEndSec, ratio);
    } else {
      const ratio = templateRatioForPhase(def.id, strokeType, defs);
      const contactRatio = (contactTime - trimStartSec) / (trimEndSec - trimStartSec);
      const adjusted = def.id === 'finish'
        ? Math.max(ratio, contactRatio + 0.12)
        : def.id === 'extension'
          ? contactRatio + (ratio - 0.68) * 0.5
          : ratio * contactRatio / 0.68;
      targetTime = timeAtRatio(trimStartSec, trimEndSec, clamp(adjusted, 0.02, 0.98));
    }
    targetTime = snapToSample(inRange.length ? inRange : samples, targetTime);
    targetTime = clamp(targetTime, trimStartSec, trimEndSec);
    markers.push({
      id: def.id,
      label: def.label,
      short: def.short,
      timeSec: Math.round(targetTime * 1000) / 1000,
    });
  }

  return enforceMonotonicMarkers(markers, trimStartSec, trimEndSec);
}

export function enforceMonotonicMarkers(
  markers: PhaseMarker[],
  trimStartSec: number,
  trimEndSec: number,
): PhaseMarker[] {
  const span = trimEndSec - trimStartSec;
  const minGap = span > 0 ? Math.min(0.04, span / (markers.length * 3)) : 0.01;
  const out: PhaseMarker[] = [];
  let prev = trimStartSec - minGap;

  for (const m of markers) {
    const t = clamp(Math.max(m.timeSec, prev + minGap), trimStartSec, trimEndSec);
    out.push({ ...m, timeSec: Math.round(t * 1000) / 1000 });
    prev = t;
  }
  return out;
}

export function phaseDefinitionMap(
  strokeType: StrokeType,
  customSteps?: PhaseDefinition[],
): Map<string, PhaseDefinition> {
  return new Map(getPhaseDefinitions(strokeType, customSteps).map((d) => [d.id, d]));
}
