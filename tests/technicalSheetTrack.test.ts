import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTechnicalSheet, parseTechnicalSheet, addTrackEntry, removeTrackEntry, entriesNewestFirst, makeRow } from '../lib/players/technicalSheet';

test('new players get the five standard tracking rows', () => {
  const rows = defaultTechnicalSheet();
  assert.deepEqual(rows.map((r) => r.label), ['Forehand', 'Backhand', 'Serve', 'Volley', 'Footwork']);
  assert.ok(rows.every((r) => r.kind === 'track' && r.entries?.length === 0));
});
test('a coach template keeps its labels; only the standard names are tracking rows', () => {
  const rows = defaultTechnicalSheet(['Forehand', 'Strengths']);
  assert.equal(rows[0].kind, 'track');
  assert.equal(rows[1].kind, undefined);
});
test('addTrackEntry adds a dated comment; empty text or bad date changes nothing', () => {
  const r = makeRow('Forehand', 'track');
  const a = addTrackEntry(r, '2026-01-01', '  late, arm close to the body ', 'x1');
  assert.deepEqual(a.entries, [{ id: 'x1', date: '2026-01-01', text: 'late, arm close to the body' }]);
  assert.equal(addTrackEntry(r, '2026-01-01', '   ', 'x2'), r);
  assert.equal(addTrackEntry(r, 'Jan 1', 'text', 'x3'), r);
});
test('removeTrackEntry and newest-first ordering', () => {
  let r = makeRow('Serve', 'track');
  r = addTrackEntry(r, '2026-01-07', 'fixed', 'b');
  r = addTrackEntry(r, '2026-01-01', 'late', 'a');
  r = addTrackEntry(r, '2026-01-07', 'timing better', 'c');
  assert.deepEqual(entriesNewestFirst(r).map((e) => e.id), ['c', 'b', 'a']);
  assert.deepEqual(removeTrackEntry(r, 'b').entries?.map((e) => e.id), ['a', 'c']);
});
test('parseTechnicalSheet keeps tracking rows and entries, drops malformed entries, still reads old rows', () => {
  const rows = parseTechnicalSheet([
    { label: 'Age', value: '20' },
    { label: 'Forehand', value: '', kind: 'track', entries: [{ id: 'a', date: '2026-01-01', text: 'ok' }, { id: 'b', date: 'bad', text: 'x' }, 5] },
  ])!;
  assert.deepEqual(rows[0], { label: 'Age', value: '20' });
  assert.equal(rows[1].kind, 'track');
  assert.equal(rows[1].entries?.length, 1);
});

import { isUntouchedOldDefault, migrateOldDefault, removeEmptyRows, OLD_DEFAULT_LABELS } from '../lib/players/technicalSheet';
const oldSheet = () => OLD_DEFAULT_LABELS.map((label) => ({ label, value: '' }));

test('an untouched old default sheet becomes the standard tracking rows', () => {
  assert.equal(isUntouchedOldDefault(oldSheet()), true);
  assert.deepEqual(migrateOldDefault(oldSheet()).map((r) => r.label), ['Forehand', 'Backhand', 'Serve', 'Volley', 'Footwork']);
});
test('a sheet with anything typed in, or any other shape, is left alone', () => {
  const typed = oldSheet(); typed[0].value = '24';
  assert.equal(migrateOldDefault(typed), typed);
  const extra = [...oldSheet(), { label: 'Injuries', value: '' }];
  assert.equal(migrateOldDefault(extra), extra);
});
test('removeEmptyRows drops empty plain rows and keeps tracking rows', () => {
  const rows = [{ label: 'Age', value: '' }, { label: 'Level', value: 'pro' }, makeRow('Serve', 'track')];
  assert.deepEqual(removeEmptyRows(rows).map((r) => r.label), ['Level', 'Serve']);
});
