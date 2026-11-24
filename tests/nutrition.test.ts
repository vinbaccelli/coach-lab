import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, validateMeal, caloriesFromMacros, planForDate, isHistory, closeForVersion, dayTotals, compareToTargets, categoryForHour, dayBefore, mealRange, customIdsOf, playerCanChangeMeal, planVisibleToPlayer, shiftDay, MAX_RANGE_DAYS } from '../lib/players/nutrition';

const plan = (id: string, starts_on: string, ends_on: string | null, status: 'active' | 'draft' | 'archived' = 'active') => ({ id, starts_on, ends_on, status });

test('validatePlan keeps targets, custom targets and meal recommendations; refuses bad dates', () => {
  const r = validatePlan({ title: 'January', starts_on: '2026-01-01', targets: { calories: '2500', protein_g: 150, custom: [{ label: 'Water', unit: 'L', target: 3 }, { label: 'Water', target: 2 }] }, meals: [{ name: 'Breakfast', time: '07:30', description: 'Oats' }, { name: '', description: '' }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.targets.calories, 2500);
  assert.deepEqual(r.value.targets.custom.map((c) => c.id), ['water', 'water_2']);
  assert.equal(r.value.meals.length, 1);
  assert.equal(r.value.meals[0].time, '07:30');
  assert.equal(r.value.ends_on, null);
  assert.equal(validatePlan({ title: 'x', starts_on: '2026-02-01', ends_on: '2026-01-01' }).ok, false);
  assert.equal(validatePlan({ title: '', starts_on: '2026-02-01' }).ok, false);
  assert.equal(validatePlan({ title: 'x', starts_on: '2026-02-01', targets: { calories: 'lots' } }).ok, false);
});

test('meals: calories calculated from macros when empty; at least something to log', () => {
  assert.equal(caloriesFromMacros(30, 50, 10), 410);
  assert.equal(caloriesFromMacros(null, null, null), null);
  const r = validateMeal({ eaten_on: '2026-01-10', category: 'lunch', description: 'Chicken and rice', protein_g: 30, carbs_g: 50, fat_g: 10 }, '2026-11-14');
  assert.ok(r.ok && r.value.calories === 410);
  const typed = validateMeal({ description: 'Salad', calories: 300, protein_g: 10 }, '2026-11-14');
  assert.ok(typed.ok && typed.value.calories === 300 && typed.value.eaten_on === '2026-11-14' && typed.value.category === 'other');
  assert.equal(validateMeal({}, '2026-11-14').ok, false);
  assert.equal(validateMeal({ description: 'x', eaten_on: '2027-01-01' }, '2026-11-14').ok, false);
  assert.equal(validateMeal({ description: 'x', calories: -5 }, '2026-11-14').ok, false);
  const ex = validateMeal({ description: 'x', extras: { water: '0.5', nope: 3 } }, '2026-11-14', ['water']);
  assert.ok(ex.ok && ex.value.extras.water === 0.5 && !('nope' in ex.value.extras));
});

test('the plan in force on a date: latest start covering it, active only', () => {
  const plans = [plan('jan', '2026-01-01', '2026-01-31'), plan('feb', '2026-02-01', null), plan('draft', '2026-02-10', null, 'draft')];
  assert.equal(planForDate(plans, '2026-01-15')?.id, 'jan');
  assert.equal(planForDate(plans, '2026-02-15')?.id, 'feb');
  assert.equal(planForDate(plans, '2025-12-31'), null);
});

test('versions close the previous plan the day before; history is read-only', () => {
  assert.deepEqual(closeForVersion({ starts_on: '2026-01-01', ends_on: null }, '2026-02-01'), { ok: true, value: { ends_on: '2026-01-31' } });
  assert.deepEqual(closeForVersion({ starts_on: '2026-01-01', ends_on: '2026-01-20' }, '2026-02-01'), { ok: true, value: { ends_on: '2026-01-20' } });
  assert.equal(closeForVersion({ starts_on: '2026-01-01', ends_on: null }, '2026-01-01').ok, false);
  assert.equal(isHistory({ ends_on: '2026-01-31' }, '2026-02-01'), true);
  assert.equal(isHistory({ ends_on: null }, '2026-02-01'), false);
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
});

test('daily totals compared with the plan targets', () => {
  const t = dayTotals([
    { calories: 600, protein_g: 40, carbs_g: 70, fat_g: 15, extras: { water: 1 } },
    { calories: 900, protein_g: 50.5, carbs_g: null, fat_g: 30, extras: { water: 0.5 } },
  ]);
  assert.deepEqual([t.calories, t.protein_g, t.fat_g, t.extras.water, t.meals], [1500, 90.5, 45, 1.5, 2]);
  const rows = compareToTargets(t, { calories: 2500, protein_g: 150, carbs_g: null, fat_g: 80, custom: [{ id: 'water', label: 'Water', unit: 'L', target: 3 }] });
  assert.deepEqual(rows.map((r) => [r.key, r.pct]), [['calories', 60], ['protein_g', 60], ['carbs_g', null], ['fat_g', 56], ['water', 50]]);
});

test('meal category from the hour', () => {
  assert.equal(categoryForHour(7), 'breakfast');
  assert.equal(categoryForHour(13), 'lunch');
  assert.equal(categoryForHour(20), 'dinner');
  assert.equal(categoryForHour(16), 'snack');
});

test('meal dates: one day of slack for players ahead of UTC, never more', () => {
  assert.ok(validateMeal({ description: 'x', eaten_on: '2026-11-15' }, '2026-11-14').ok);
  assert.equal(validateMeal({ description: 'x', eaten_on: '2026-11-16' }, '2026-11-14').ok, false);
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
});

test('a photo alone is enough to log a meal; a photo URL from the body is not trusted by the routes', () => {
  assert.equal(validateMeal({ category: 'lunch' }, '2026-11-14').ok, false);
  assert.ok(validateMeal({ category: 'lunch' }, '2026-11-14', [], { photo: true }).ok);
});

test('meal ranges default to the last 7 days and are capped', () => {
  assert.deepEqual(mealRange(null, null, '2026-11-14'), { from: '2026-11-08', to: '2026-11-14' });
  assert.deepEqual(mealRange('2026-11-20', '2026-11-10', '2026-11-14'), { from: '2026-11-10', to: '2026-11-10' });
  assert.deepEqual(mealRange('2025-01-01', '2026-11-14', '2026-11-14'), { from: shiftDay('2026-11-14', -MAX_RANGE_DAYS), to: '2026-11-14' });
  assert.deepEqual(mealRange('nope', 'also nope', '2026-11-14'), { from: '2026-11-08', to: '2026-11-14' });
});

test('custom values a meal may carry come from the player\'s plans', () => {
  const ids = customIdsOf([{ targets: { custom: [{ id: 'water', label: 'Water', unit: 'L', target: 3 }] } }, { targets: {} }, { targets: null }, { targets: { custom: [{ id: 'fibre' }, { id: 'water' }] } }]);
  assert.deepEqual(ids, ['water', 'fibre']);
});

test('the player sees active plans only and changes only their own meals until approved', () => {
  assert.equal(planVisibleToPlayer({ status: 'active' }), true);
  assert.equal(planVisibleToPlayer({ status: 'draft' }), false);
  assert.equal(planVisibleToPlayer({ status: 'archived' }), false);
  assert.equal(playerCanChangeMeal({ author: 'link', status: 'submitted' }), true);
  assert.equal(playerCanChangeMeal({ author: 'link', status: 'needs_revision' }), true);
  assert.equal(playerCanChangeMeal({ author: 'link', status: 'approved' }), false);
  assert.equal(playerCanChangeMeal({ author: 'coach', status: 'submitted' }), false);
});
