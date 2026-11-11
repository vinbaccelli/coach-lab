import test from 'node:test';
import assert from 'node:assert/strict';
import { chartPoints, groupMetrics, validateMetricInput, type MetricRow } from '../lib/players/metrics';

const row = (id: string, name: string, unit: string, value: number, d: string): MetricRow => ({ id, name, unit, value, recorded_on: d });

test('groups by name+unit (case-insensitive), sorted by date, with latest and change', () => {
  const s = groupMetrics([
    row('3', 'Weight', 'kg', 70, '2026-03-01'),
    row('1', 'weight ', 'KG', 72, '2026-01-01'),
    row('2', 'Fat', '%', 15, '2026-02-01'),
  ]);
  assert.equal(s.length, 2);
  const w = s.find((x) => x.name.toLowerCase() === 'weight')!;
  assert.deepEqual(w.points.map((p) => p.id), ['1', '3']);
  assert.equal(w.latest.value, 70);
  assert.equal(w.change, -2);
  assert.equal(s.find((x) => x.name === 'Fat')!.change, null);
});

test('same name with a different unit is a separate series', () => {
  assert.equal(groupMetrics([row('1', 'Time', 'min', 25, '2026-01-01'), row('2', 'Time', 's', 1500, '2026-01-02')]).length, 2);
});

test('validation accepts a good body and defaults the date', () => {
  const r = validateMetricInput({ name: ' Weight ', unit: 'kg', value: '71.5' }, '2026-05-05');
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.input, { name: 'Weight', unit: 'kg', value: 71.5, recorded_on: '2026-05-05', note: null });
});

test('validation rejects empty name, non-numeric value, bad date, long unit', () => {
  assert.equal(validateMetricInput({ name: '', value: 1 }, '2026-05-05').ok, false);
  assert.equal(validateMetricInput({ name: 'x', value: 'abc' }, '2026-05-05').ok, false);
  assert.equal(validateMetricInput({ name: 'x', value: 1, recorded_on: '05/05/2026' }, '2026-05-05').ok, false);
  assert.equal(validateMetricInput({ name: 'x', value: 1, unit: 'a'.repeat(17) }, '2026-05-05').ok, false);
  assert.equal(validateMetricInput({ name: 'x', value: null }, '2026-05-05').ok, false);
});

test('chart points: spaced by date, higher value is higher on screen, single point centred', () => {
  const p = chartPoints([row('1', 'a', '', 10, '2026-01-01'), row('2', 'a', '', 20, '2026-01-11'), row('3', 'a', '', 15, '2026-01-21')], 100, 50, 0);
  assert.equal(p[0].x, 0); assert.equal(p[2].x, 100); assert.equal(p[1].x, 50);
  assert.ok(p[1].y < p[0].y);
  const one = chartPoints([row('1', 'a', '', 10, '2026-01-01')], 100, 50, 0);
  assert.deepEqual(one, [{ x: 50, y: 25 }]);
});
