import type { PhaseDefinition, PhaseMarker } from '@/lib/biomechanics/types';

export const DEFAULT_CUSTOM_STEPS: PhaseDefinition[] = [
  { id: 'step_1', label: 'Step 1', short: '1' },
  { id: 'step_2', label: 'Step 2', short: '2' },
  { id: 'step_3', label: 'Step 3', short: '3' },
  { id: 'step_4', label: 'Step 4', short: '4' },
];

let customStepCounter = 0;

export function createCustomStepId(): string {
  customStepCounter += 1;
  return `step_${Date.now()}_${customStepCounter}`;
}

/** Short label for timeline chips — first 2–3 chars of each word, or index. */
export function makeStepShort(label: string, fallbackIndex: number): string {
  const trimmed = label.trim();
  if (!trimmed) return String(fallbackIndex + 1);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return trimmed.slice(0, 3).toUpperCase();
  }
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function definitionToMarker(
  def: PhaseDefinition,
  timeSec: number,
): PhaseMarker {
  return {
    id: def.id,
    label: def.label,
    short: def.short,
    timeSec: Math.round(timeSec * 1000) / 1000,
  };
}

export function syncMarkersWithDefinitions(
  defs: PhaseDefinition[],
  existing: PhaseMarker[],
  trimStartSec: number,
  trimEndSec: number,
): PhaseMarker[] {
  const span = trimEndSec - trimStartSec;
  const byId = new Map(existing.map((m) => [m.id, m]));
  const kept = defs.map((def, i) => {
    const prev = byId.get(def.id);
    if (prev) {
      return { ...prev, label: def.label, short: def.short };
    }
    const ratio = (i + 1) / (defs.length + 1);
    return definitionToMarker(def, trimStartSec + span * ratio);
  });
  return kept;
}
