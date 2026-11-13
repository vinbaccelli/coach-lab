/**
 * Starting points for trackers. A preset only fills in a tracker definition: once created, the
 * coach can rename, add or archive measurements like any custom tracker. Nothing here is
 * stored in the database as a template, so adding presets never needs a migration.
 */
import type { TrackerDefinition, TrackerField, TrackerCategory } from '@/lib/players/trackers';

export interface TrackerPreset {
  key: string;
  label: string;
  hint: string;
  definition: TrackerDefinition;
}

const f = (id: string, label: string, kind: TrackerField['kind'], unit: string, better: TrackerField['better'] = null, computed?: TrackerField['computed']): TrackerField =>
  computed ? { id, label, kind, unit, better, computed } : { id, label, kind, unit, better };

const def = (category: TrackerCategory, preset: string, name: string, mode: 'single' | 'sets', fields: TrackerField[], description = ''): TrackerDefinition =>
  ({ name, description, category, preset, mode, fields });

/** Biometrics: height changes rarely, weight and body composition often; BMI is calculated. */
export const BIOMETRICS_PRESET: TrackerPreset = {
  key: 'biometrics',
  label: 'Biometrics',
  hint: 'Height, weight, BMI (calculated), body fat %, lean mass %',
  definition: def('biometrics', 'biometrics', 'Biometrics', 'single', [
    f('height', 'Height', 'length', 'cm'),
    f('weight', 'Weight', 'weight', 'kg'),
    f('bmi', 'BMI', 'number', '', null, 'bmi'),
    f('body_fat', 'Body fat', 'percent', '%', 'lower'),
    f('lean_mass', 'Lean mass', 'percent', '%', 'higher'),
  ], 'Fill in only what you measured that day: BMI is calculated from the weight and the latest height.'),
};

/** Extra measurements offered when editing a biometrics tracker. */
export const BIOMETRICS_EXTRA_FIELDS: TrackerField[] = [
  f('muscle_mass', 'Muscle mass', 'weight', 'kg', 'higher'),
  f('lean_body_mass', 'Lean body mass', 'weight', 'kg', 'higher'),
  f('waist', 'Waist', 'length', 'cm'),
  f('wingspan', 'Wingspan', 'length', 'cm'),
  f('resting_hr', 'Resting heart rate', 'number', 'bpm', 'lower'),
];

/** Fitness examples. Each is its own tracker so its chart and history stay readable. */
export const FITNESS_PRESETS: TrackerPreset[] = [
  { key: 'run', label: 'Running', hint: 'Distance and time (pace calculated)', definition: def('fitness', 'fitness.run', '5 km run', 'single', [
    f('distance', 'Distance', 'distance', 'km'), f('time', 'Time', 'duration', 'min', 'lower'), f('pace', 'Pace', 'duration', 'min', 'lower', 'pace'),
  ]) },
  { key: 'pushups', label: 'Push-ups', hint: 'Repetitions per set', definition: def('fitness', 'fitness.pushups', 'Push-ups', 'sets', [
    f('reps', 'Reps', 'count', 'reps', 'higher'),
  ]) },
  { key: 'squat', label: 'Squat', hint: 'Repetitions and weight per set', definition: def('fitness', 'fitness.squat', 'Squat', 'sets', [
    f('reps', 'Reps', 'count', 'reps', 'higher'), f('weight', 'Weight', 'weight', 'kg', 'higher'),
  ]) },
  { key: 'pullups', label: 'Pull-ups', hint: 'Repetitions per set', definition: def('fitness', 'fitness.pullups', 'Pull-ups', 'sets', [
    f('reps', 'Reps', 'count', 'reps', 'higher'),
  ]) },
  { key: 'plank', label: 'Plank', hint: 'Time per set', definition: def('fitness', 'fitness.plank', 'Plank', 'sets', [
    f('time', 'Time', 'duration', 's', 'higher'),
  ]) },
  { key: 'jump', label: 'Jump test', hint: 'Countermovement jump height', definition: def('fitness', 'fitness.jump', 'Countermovement jump', 'single', [
    f('height', 'Jump height', 'length', 'cm', 'higher'),
  ]) },
  { key: 'sprint', label: 'Sprint', hint: '20 m sprint time', definition: def('fitness', 'fitness.sprint', '20 m sprint', 'single', [
    f('time', 'Time', 'duration', 's', 'lower'),
  ]) },
  { key: 'strength', label: 'Strength test', hint: 'One-rep max', definition: def('fitness', 'fitness.strength', 'Bench press 1RM', 'single', [
    f('weight', 'Weight', 'weight', 'kg', 'higher'),
  ]) },
  { key: 'mobility', label: 'Mobility test', hint: 'Sit and reach', definition: def('fitness', 'fitness.mobility', 'Sit and reach', 'single', [
    f('reach', 'Reach', 'length', 'cm', 'higher'),
  ]) },
];

/** A blank tracker for the coach to shape. */
export function blankDefinition(category: TrackerCategory): TrackerDefinition {
  return def(category, '', '', 'single', [f('value', 'Value', 'number', '')]);
}

export function presetByKey(key: string): TrackerPreset | null {
  if (key === BIOMETRICS_PRESET.key) return BIOMETRICS_PRESET;
  return FITNESS_PRESETS.find((p) => p.key === key) ?? null;
}

/** Presets offered in a section. */
export function presetsFor(category: TrackerCategory): TrackerPreset[] {
  if (category === 'biometrics') return [BIOMETRICS_PRESET];
  if (category === 'fitness') return FITNESS_PRESETS;
  return [];
}
