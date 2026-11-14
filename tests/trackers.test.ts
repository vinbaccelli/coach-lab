import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldIdFor, validateTrackerDefinition, checkFieldChanges, parseFieldInput, validateEntry, computeDerived,
  buildSeries, defaultSeriesKey, seriesChange, formatValue, formatDuration, describeEntry, inputValue,
  type TrackerEntry, type TrackerDefinition,
} from '../lib/players/trackers';
import { BIOMETRICS_PRESET, FITNESS_PRESETS, presetByKey, blankDefinition } from '../lib/players/trackerPresets';

const entry = (id: string, date: string, measurements: Record<string, number>, extra: Partial<TrackerEntry> = {}): TrackerEntry => ({
  id, tracker_id: 't', entry_date: date, measurements, sets: null, note: '', author: 'coach', status: 'approved',
  created_at: `${date}T10:00:00Z`, updated_at: `${date}T10:00:00Z`, ...extra,
});
const setsEntry = (id: string, date: string, sets: Array<Record<string, number>>, extra: Partial<TrackerEntry> = {}) =>
  entry(id, date, {}, { sets, ...extra });

test('fieldIdFor makes stable, unique ids from labels', () => {
  assert.equal(fieldIdFor('Body fat %'), 'body_fat');
  assert.equal(fieldIdFor('Body fat %', ['body_fat']), 'body_fat_2');
  assert.equal(fieldIdFor('20 m'), 'f_20_m');
});

test('every preset and the blank tracker are valid definitions', () => {
  for (const p of [BIOMETRICS_PRESET, ...FITNESS_PRESETS]) {
    const r = validateTrackerDefinition(p.definition);
    assert.ok(r.ok, `${p.key}: ${!r.ok ? r.error : ''}`);
  }
  assert.ok(validateTrackerDefinition({ ...blankDefinition('progress'), name: 'Serve speed' }).ok);
  assert.equal(presetByKey('squat')?.definition.mode, 'sets');
  assert.equal(presetByKey('nope'), null);
});

test('validateTrackerDefinition refuses broken definitions', () => {
  assert.equal(validateTrackerDefinition({ name: '', fields: [{ label: 'x', kind: 'number' }] }).ok, false);
  assert.equal(validateTrackerDefinition({ name: 'A', fields: [] }).ok, false);
  const bmiOnly = validateTrackerDefinition({ name: 'A', fields: [{ label: 'Weight', kind: 'weight' }, { label: 'BMI', kind: 'number', computed: 'bmi' }] });
  assert.equal(bmiOnly.ok, false);
  const setsComputed = validateTrackerDefinition({ name: 'A', mode: 'sets', fields: [{ label: 'Time', kind: 'duration' }, { label: 'Dist', kind: 'distance' }, { label: 'Pace', kind: 'duration', computed: 'pace' }] });
  assert.equal(setsComputed.ok, false);
  const dupIds = validateTrackerDefinition({ name: 'A', fields: [{ id: 'x', label: 'X', kind: 'number' }, { id: 'x', label: 'Y', kind: 'number' }] });
  assert.equal(dupIds.ok, false);
});

test('validateTrackerDefinition fixes a unit that does not fit the kind', () => {
  const r = validateTrackerDefinition({ name: 'A', fields: [{ label: 'Weight', kind: 'weight', unit: 'cm' }] });
  assert.ok(r.ok && r.value.fields[0].unit === 'kg');
});

test('checkFieldChanges: a field with history cannot disappear or change type', () => {
  const before = BIOMETRICS_PRESET.definition.fields;
  assert.equal(checkFieldChanges(before, before.map((x) => ({ ...x, label: x.label + '!' }))), null);
  assert.match(checkFieldChanges(before, before.slice(1)) ?? '', /archive/);
  assert.match(checkFieldChanges(before, before.map((x) => (x.id === 'weight' ? { ...x, kind: 'number' as const } : x))) ?? '', /type/);
});

test('parseFieldInput reads times as m:ss, h:mm:ss or a number in the field unit', () => {
  assert.equal(parseFieldInput({ kind: 'duration', unit: 'min' }, '24:30'), 1470);
  assert.equal(parseFieldInput({ kind: 'duration', unit: 'min' }, '1:02:03'), 3723);
  assert.equal(parseFieldInput({ kind: 'duration', unit: 'min' }, '24'), 1440);
  assert.equal(parseFieldInput({ kind: 'duration', unit: 's' }, '60'), 60);
  assert.equal(parseFieldInput({ kind: 'duration', unit: 'min' }, '24:3a'), 'invalid');
  assert.equal(parseFieldInput({ kind: 'weight', unit: 'kg' }, ' 72,5 '), 72.5);
  assert.equal(parseFieldInput({ kind: 'percent', unit: '%' }, '14%'), 14);
  assert.equal(parseFieldInput({ kind: 'weight', unit: 'kg' }, ''), null);
  assert.equal(parseFieldInput({ kind: 'weight', unit: 'kg' }, 'abc'), 'invalid');
});

test('validateEntry: single mode keeps known values, refuses unknown, calculated, out of range', () => {
  const t = BIOMETRICS_PRESET.definition;
  const ok = validateEntry(t, { entry_date: '2026-01-10', measurements: { weight: 72.5, body_fat: '' } }, '2026-11-14');
  assert.ok(ok.ok && ok.value.measurements.weight === 72.5 && !('body_fat' in ok.value.measurements));
  assert.equal(validateEntry(t, { measurements: { bmi: 22 } }, '2026-11-14').ok, false);
  assert.equal(validateEntry(t, { measurements: { nope: 1 } }, '2026-11-14').ok, false);
  assert.equal(validateEntry(t, { measurements: { body_fat: 140 } }, '2026-11-14').ok, false);
  assert.equal(validateEntry(t, { measurements: {} }, '2026-11-14').ok, false);
  assert.equal(validateEntry(t, { entry_date: '2027-01-01', measurements: { weight: 70 } }, '2026-11-14').ok, false);
  const d = validateEntry(t, { measurements: { weight: 70 } }, '2026-11-14');
  assert.ok(d.ok && d.value.entry_date === '2026-11-14');
});

test('validateEntry: sets mode drops empty sets and needs whole reps', () => {
  const squat = presetByKey('squat')!.definition;
  const r = validateEntry(squat, { entry_date: '2026-01-10', sets: [{ reps: 12, weight: 40 }, {}, { reps: 10, weight: 40 }] }, '2026-11-14');
  assert.ok(r.ok && r.value.sets?.length === 2);
  assert.equal(validateEntry(squat, { sets: [{ reps: 10.5 }] }, '2026-11-14').ok, false);
  assert.equal(validateEntry(squat, { sets: [{}] }, '2026-11-14').ok, false);
  assert.equal(validateEntry(squat, { sets: Array.from({ length: 31 }, () => ({ reps: 1 })) }, '2026-11-14').ok, false);
});

test('BMI uses the latest earlier height, else the nearest later one, and converts units', () => {
  const t = BIOMETRICS_PRESET.definition;
  const entries = [
    entry('a', '2026-01-01', { weight: 70 }),
    entry('b', '2026-01-05', { height: 175 }),
    entry('c', '2026-01-10', { weight: 72 }),
    entry('d', '2026-03-01', { height: 180, weight: 72 }),
  ];
  const d = computeDerived(t, entries);
  assert.equal(d.get('a')?.bmi, 22.9);
  assert.equal(d.get('c')?.bmi, 23.5);
  assert.equal(d.get('d')?.bmi, 22.2);
  assert.equal(d.has('b'), false);
  const imperial: TrackerDefinition = { ...t, fields: t.fields.map((x) => (x.id === 'height' ? { ...x, unit: 'in' } : x.id === 'weight' ? { ...x, unit: 'lb' } : x)) };
  const di = computeDerived(imperial, [entry('x', '2026-01-01', { height: 70, weight: 160 })]);
  assert.equal(di.get('x')?.bmi, 23);
});

test('pace = time / distance in seconds per km', () => {
  const run = presetByKey('run')!.definition;
  const d = computeDerived(run, [entry('r', '2026-01-10', { distance: 5, time: 1500 })]);
  assert.equal(d.get('r')?.pace, 300);
  assert.equal(formatValue(300, 'duration', 'min', { computed: 'pace' }), '5:00 /km');
});

test('series: single mode, one per measurement, pending points marked, needs-revision left out', () => {
  const t = BIOMETRICS_PRESET.definition;
  const s = buildSeries(t, [
    entry('a', '2026-01-01', { height: 175, weight: 70 }),
    entry('b', '2026-02-01', { weight: 71 }, { status: 'submitted', author: 'link' }),
    entry('c', '2026-03-01', { weight: 90 }, { status: 'needs_revision', author: 'link' }),
  ]);
  const weight = s.find((x) => x.key === 'weight')!;
  assert.deepEqual(weight.points.map((p) => [p.value, p.pending]), [[70, false], [71, true]]);
  assert.deepEqual(s.find((x) => x.key === 'bmi')!.points.map((p) => p.value), [22.9, 23.2]);
  assert.equal(defaultSeriesKey(t, s), 'weight');
});

test('series: sets mode gives top weight, total reps, volume and sets', () => {
  const squat = presetByKey('squat')!.definition;
  const s = buildSeries(squat, [
    setsEntry('a', '2026-01-10', [{ reps: 10, weight: 40 }, { reps: 10, weight: 40 }, { reps: 10, weight: 40 }]),
    setsEntry('b', '2026-01-20', [{ reps: 12, weight: 45 }, { reps: 10, weight: 45 }]),
  ]);
  const get = (k: string) => s.find((x) => x.key === k)!.points.map((p) => p.value);
  assert.deepEqual(get('weight:best'), [40, 45]);
  assert.deepEqual(get('reps:total'), [30, 22]);
  assert.deepEqual(get('volume'), [1200, 990]);
  assert.deepEqual(get('sets'), [3, 2]);
  assert.equal(defaultSeriesKey(squat, s), 'weight:best');
});

test('seriesChange knows that a lower run time is an improvement', () => {
  const run = presetByKey('run')!.definition;
  const s = buildSeries(run, [entry('a', '2026-01-10', { distance: 5, time: 1680 }), entry('b', '2026-02-05', { distance: 5, time: 1440 })]);
  const time = s.find((x) => x.key === 'time')!;
  assert.deepEqual(seriesChange(time), { first: 1680, latest: 1440, delta: -240, improved: true });
  assert.equal(seriesChange({ ...time, points: time.points.slice(0, 1) }), null);
});

test('formatting reads naturally and round-trips durations', () => {
  assert.equal(formatDuration(1470), '24:30');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatValue(72.456, 'weight', 'kg'), '72.46 kg');
  assert.equal(formatValue(14, 'percent', '%'), '14 %');
  assert.equal(formatValue(8, 'score', '/10'), '8/10');
  assert.equal(inputValue(1470, { kind: 'duration' }), '24:30');
  const squat = presetByKey('squat')!.definition;
  assert.equal(describeEntry(squat, { measurements: {}, sets: [{ reps: 12, weight: 40 }, { reps: 10, weight: 40 }] }), '2 sets: 12 × 40 kg, 10 × 40 kg');
  assert.equal(describeEntry(BIOMETRICS_PRESET.definition, { measurements: { weight: 72 }, sets: null }, { bmi: 23.5 }), 'Weight 72 kg · BMI 23.5');
});
