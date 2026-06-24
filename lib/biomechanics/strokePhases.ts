import type { PhaseDefinition, StrokeType } from '@/lib/biomechanics/types';

/** Phase structure per preset analysis type — matches AngleMotion eBook. */
export const STROKE_PHASE_DEFINITIONS: Record<Exclude<StrokeType, 'custom'>, PhaseDefinition[]> = {
  // Part I: Spin Groundstrokes (G1–G8)
  forehand: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recovery', short: 'FR' },
  ],
  two_handed_backhand: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recovery', short: 'FR' },
  ],
  one_handed_backhand: [
    { id: 'split_step', label: 'Split Step', short: 'SS' },
    { id: 'unit_turn', label: 'Unit Turn', short: 'UT' },
    { id: 'power_position', label: 'Power Position', short: 'PP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'racket_lag', label: 'Racket Lag', short: 'RL' },
    { id: 'contact', label: 'Contact', short: 'C' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'finish', label: 'Finish & Recovery', short: 'FR' },
  ],
  // Part II: The Serve (S1–S8)
  serve: [
    { id: 'setup_stance', label: 'Setup & Stance', short: 'SS' },
    { id: 'initiation', label: 'Initiation — Toss & Takeback', short: 'IT' },
    { id: 'trophy', label: 'Trophy Position', short: 'TP' },
    { id: 'racket_drop', label: 'Racket Drop', short: 'RD' },
    { id: 'leg_drive', label: 'Leg Drive & Launch', short: 'LD' },
    { id: 'pronation_contact', label: 'Pronation & Contact', short: 'PC' },
    { id: 'extension', label: 'Extension', short: 'E' },
    { id: 'landing', label: 'Landing & Recovery', short: 'LR' },
  ],
  // Part III: Volleys (V1–V2)
  volley: [
    { id: 'preparation', label: 'Preparation: Split — Turn — Set', short: 'P' },
    { id: 'punch_recovery', label: 'Punch & Recovery', short: 'PR' },
  ],
  // Smash uses same 2-step volley pattern
  smash: [
    { id: 'preparation', label: 'Preparation: Split — Turn — Set', short: 'P' },
    { id: 'punch_recovery', label: 'Punch & Recovery', short: 'PR' },
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

/** Template ratios (0–1 within trim) for placing phase markers. */
export const PHASE_TEMPLATE_RATIOS: Record<string, number> = {
  // Groundstrokes (8 steps)
  split_step: 0.02,
  unit_turn: 0.14,
  power_position: 0.28,
  racket_drop: 0.42,
  racket_lag: 0.55,
  contact: 0.68,
  extension: 0.80,
  finish: 0.92,
  // Serve (8 steps)
  setup_stance: 0.02,
  initiation: 0.14,
  trophy: 0.28,
  leg_drive: 0.50,
  pronation_contact: 0.68,
  landing: 0.92,
  // Volleys / Smash (2 steps)
  preparation: 0.25,
  punch_recovery: 0.75,
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
