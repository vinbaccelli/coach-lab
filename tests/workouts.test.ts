import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateExercise, searchExercises, validateItems, validateWorkout, describePlanned, scheduleDates, validateLog,
  logFromPlan, describeDone, comparePlanned, workoutState, MAX_SERIES,
} from '../lib/players/workouts';

test('exercises: defaults, lists cleaned, links must be http(s)', () => {
  const r = validateExercise({ name: '  Lateral bound ', category: 'plyometrics', muscle_groups: 'Glutes, quads,glutes', equipment: [], video_url: 'javascript:alert(1)', log_fields: ['reps', 'bogus'] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.name, 'Lateral bound');
  assert.deepEqual(r.value.muscle_groups, ['glutes', 'quads']);
  assert.equal(r.value.video_url, null);
  assert.deepEqual(r.value.log_fields, ['reps']);
  assert.equal(r.value.difficulty, 'intermediate');
  assert.equal(validateExercise({ name: ' ' }).ok, false);
  assert.deepEqual(validateExercise({ name: 'x', category: 'weird' }).ok && validateExercise({ name: 'x', category: 'weird' }), { ok: true, value: { ...(validateExercise({ name: 'x' }) as { value: object }).value } });
});

test('exercise search: every word must match name, muscles, equipment, category or sport', () => {
  const lib = [
    { name: 'Push-up', muscle_groups: ['chest'], equipment: ['bodyweight'], category: 'strength', sports: ['general'] },
    { name: 'Band external rotation', muscle_groups: ['rotator cuff'], equipment: ['band'], category: 'tennis', sports: ['tennis'] },
  ];
  assert.deepEqual(searchExercises(lib, 'band').map((e) => e.name), ['Band external rotation']);
  assert.deepEqual(searchExercises(lib, 'chest bodyweight').map((e) => e.name), ['Push-up']);
  assert.deepEqual(searchExercises(lib, '', 'tennis').map((e) => e.name), ['Band external rotation']);
  assert.deepEqual(searchExercises(lib, 'tennis-specific').map((e) => e.name), ['Band external rotation']);
});

test('planned items: numbers, times as m:ss, unique ids, empty names dropped', () => {
  const r = validateItems([
    { id: 'a', name: 'Squat', sets: '3', reps: 12, weight_kg: '40,5', rest_s: '1:30' },
    { id: 'a', name: 'Plank', sets: 3, duration_s: '0:45', log_fields: ['duration'] },
    { name: '' },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.length, 2);
  assert.deepEqual([r.value[0].sets, r.value[0].weight_kg, r.value[0].rest_s], [3, 40.5, 90]);
  assert.notEqual(r.value[0].id, r.value[1].id);
  assert.equal(r.value[1].duration_s, 45);
  assert.equal(describePlanned(r.value[0]), '3 × 12 × 40.5 kg, rest 1:30');
  assert.equal(describePlanned(r.value[1]), '3 × 0:45');
  assert.equal(validateItems([{ name: 'x', reps: -1 }]).ok, false);
  assert.equal(validateWorkout({ title: '', items: [] }).ok, false);
});

test('schedule: one date, or the chosen weekdays for N weeks (capped)', () => {
  assert.deepEqual(scheduleDates('2026-11-16', [], 4), { ok: true, value: ['2026-11-16'] });
  // 2026-11-16 is a Monday: Mon + Thu for 2 weeks.
  assert.deepEqual(scheduleDates('2026-11-16', [1, 4], 2), { ok: true, value: ['2026-11-16', '2026-11-19', '2026-11-23', '2026-11-26'] });
  const many = scheduleDates('2026-01-01', [0, 1, 2, 3, 4, 5, 6], 52);
  assert.ok(many.ok && many.value.length === MAX_SERIES);
  assert.equal(scheduleDates('nope', [1], 2).ok, false);
  assert.equal(scheduleDates('2026-11-16', [1], 0).ok, false);
});

test('logs: sets kept as done, future dates refused, something must be logged', () => {
  const r = validateLog({ performed_on: '2026-11-14', title: 'Legs', rpe: 7, items: [{ name: 'Squat', planned_id: 'a', sets: [{ reps: 12, weight_kg: 40 }, { reps: 10, weight_kg: '42.5' }, {}] }] }, '2026-11-14');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.items[0].sets.length, 2);
  assert.equal(r.value.items[0].sets[1].weight_kg, 42.5);
  assert.equal(validateLog({ performed_on: '2026-11-20', items: [{ name: 'x', sets: [{ reps: 1 }] }] }, '2026-11-14').ok, false);
  assert.equal(validateLog({ items: [{ name: 'x', sets: [] }] }, '2026-11-14').ok, false);
  assert.ok(validateLog({ notes: 'Rest day walk' }, '2026-11-14').ok);
  assert.equal(validateLog({ rpe: 11, notes: 'x' }, '2026-11-14').ok, false);
});

test('planned against done: done, partial, missed and extra exercises', () => {
  const plan = validateItems([
    { id: 'a', name: 'Squat', sets: 3, reps: 12, weight_kg: 40 },
    { id: 'b', name: 'Plank', sets: 3, duration_s: 45 },
    { id: 'c', name: 'Lunge', sets: 2, reps: 10 },
  ]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  const prefilled = logFromPlan(plan.value);
  assert.equal(prefilled[0].sets.length, 3);
  assert.deepEqual(prefilled[0].sets[0], { reps: 12, weight_kg: 40 });
  const rows = comparePlanned(plan.value, [
    { ...prefilled[0] },
    { ...prefilled[1], sets: prefilled[1].sets.slice(0, 2) },
    { id: 'z', exercise_id: null, planned_id: null, name: 'Jump rope', sets: [{ duration_s: 120 }], notes: '' },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.status]), [['Squat', 'done'], ['Plank', 'partial'], ['Lunge', 'missed'], ['Jump rope', 'done']]);
  assert.equal(rows[0].done, '3 × 12 × 40 kg');
  assert.equal(rows[3].extra, true);
  assert.equal(describeDone([]), 'not done');
});

test('workout state from the date, the log and skipping', () => {
  assert.equal(workoutState({ scheduled_on: '2026-11-10', status: 'planned' }, true, '2026-11-14'), 'done');
  assert.equal(workoutState({ scheduled_on: '2026-11-10', status: 'planned' }, false, '2026-11-14'), 'missed');
  assert.equal(workoutState({ scheduled_on: '2026-11-14', status: 'planned' }, false, '2026-11-14'), 'today');
  assert.equal(workoutState({ scheduled_on: '2026-11-20', status: 'planned' }, false, '2026-11-14'), 'upcoming');
  assert.equal(workoutState({ scheduled_on: '2026-11-10', status: 'skipped' }, false, '2026-11-14'), 'skipped');
});
