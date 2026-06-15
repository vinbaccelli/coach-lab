import type { PhaseDefinition, StrokeType } from '@/lib/biomechanics/types';

/** Phase structure per preset analysis type — user-selected, not auto-detected. */
export const STROKE_PHASE_DEFINITIONS: Record<Exclude<StrokeType, 'custom'>, PhaseDefinition[]> = {
  forehand: [
    { id: 'preparation', label: 'Preparation', short: 'P' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'U' },
    { id: 'loading', label: 'Loading', short: 'L' },
    { id: 'acceleration', label: 'Acceleration', short: 'A' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish', short: 'F' },
    { id: 'recovery', label: 'Recovery', short: 'R' },
  ],
  two_handed_backhand: [
    { id: 'preparation', label: 'Preparation', short: 'P' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'U' },
    { id: 'loading', label: 'Loading', short: 'L' },
    { id: 'forward_swing', label: 'Forward Swing', short: 'F' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish', short: 'Fi' },
    { id: 'recovery', label: 'Recovery', short: 'R' },
  ],
  one_handed_backhand: [
    { id: 'preparation', label: 'Preparation', short: 'P' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'U' },
    { id: 'loading', label: 'Loading', short: 'L' },
    { id: 'forward_swing', label: 'Forward Swing', short: 'F' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish', short: 'Fi' },
    { id: 'recovery', label: 'Recovery', short: 'R' },
  ],
  serve: [
    { id: 'preparation', label: 'Preparation', short: 'P' },
    { id: 'trophy', label: 'Trophy', short: 'T' },
    { id: 'loading', label: 'Loading / Drop', short: 'L' },
    { id: 'acceleration', label: 'Acceleration', short: 'A' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'pronation', label: 'Pronation', short: 'Pr' },
    { id: 'finish', label: 'Finish', short: 'F' },
    { id: 'recovery', label: 'Recovery', short: 'R' },
  ],
  volley: [
    { id: 'preparation', label: 'Preparation', short: 'P' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'U' },
    { id: 'forward_prep', label: 'Forward Prep', short: 'FP' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'finish', label: 'Finish', short: 'F' },
    { id: 'recovery', label: 'Recovery', short: 'R' },
  ],
  smash: [
    { id: 'preparation', label: 'Preparation', short: 'P' },
    { id: 'loading', label: 'Loading', short: 'L' },
    { id: 'acceleration', label: 'Acceleration', short: 'A' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish', short: 'F' },
    { id: 'recovery', label: 'Recovery', short: 'R' },
  ],
};

export const STROKE_TYPE_LABELS: Record<StrokeType, string> = {
  forehand: 'Forehand',
  two_handed_backhand: 'Two-Handed Backhand',
  one_handed_backhand: 'One-Handed Backhand',
  serve: 'Serve',
  volley: 'Volley',
  smash: 'Smash',
  custom: 'Custom',
};

export const STROKE_TYPES = Object.keys(STROKE_TYPE_LABELS) as StrokeType[];

/** Preset stroke types (excludes custom). */
export const PRESET_STROKE_TYPES = STROKE_TYPES.filter((t) => t !== 'custom');

/** Template ratios (0–1 within trim) for placing phase markers before contact peak. */
export const PHASE_TEMPLATE_RATIOS: Record<string, number> = {
  preparation: 0.05,
  unit_turn: 0.18,
  loading: 0.28,
  forward_swing: 0.42,
  forward_prep: 0.38,
  trophy: 0.22,
  acceleration: 0.55,
  contact: 0.68,
  extension: 0.78,
  pronation: 0.82,
  forward_swing_alt: 0.45,
  finish: 0.88,
  recovery: 0.96,
};

export function getPhaseDefinitions(
  strokeType: StrokeType,
  customSteps?: PhaseDefinition[],
): PhaseDefinition[] {
  if (strokeType === 'custom') {
    return customSteps?.length ? customSteps : [];
  }
  return STROKE_PHASE_DEFINITIONS[strokeType as Exclude<StrokeType, 'custom'>];
}
