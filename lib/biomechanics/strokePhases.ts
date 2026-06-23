import type { PhaseDefinition, StrokeType } from '@/lib/biomechanics/types';

/** Phase structure per preset analysis type — 8-step eBook sequence. */
export const STROKE_PHASE_DEFINITIONS: Record<Exclude<StrokeType, 'custom'>, PhaseDefinition[]> = {
  forehand: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recover', short: 'FR' },
  ],
  two_handed_backhand: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recover', short: 'FR' },
  ],
  one_handed_backhand: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recover', short: 'FR' },
  ],
  serve: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recover', short: 'FR' },
  ],
  volley: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recover', short: 'FR' },
  ],
  smash: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recover', short: 'FR' },
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

export const PRESET_STROKE_TYPES = STROKE_TYPES.filter((t) => t !== 'custom');

/** Template ratios (0–1 within trim) for placing phase markers before contact peak. */
export const PHASE_TEMPLATE_RATIOS: Record<string, number> = {
  split_step: 0.02,
  unit_turn: 0.14,
  power_position: 0.28,
  racket_drop: 0.42,
  racket_lag: 0.55,
  contact: 0.68,
  extension: 0.80,
  finish: 0.92,
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
