import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareHistory, encodeCursor, parseCursor, mergePage, matches, parseFilter, filterActive, sectionsForLink,
  itemFromTimeline, itemFromTrackerEntry, itemFromMeal, itemFromPlan, itemsFromSheet, itemFromMetric, type HistoryItem,
} from '../lib/players/history';
import { defaultPermissions, resolvePermissions } from '../lib/players/sharePermissions';

const it = (key: string, date: string, created_at: string, extra: Partial<HistoryItem> = {}): HistoryItem =>
  ({ key, type: 'comment', section: 'timeline', date, created_at, title: key, author: 'coach', ...extra });
const none = parseFilter(new URLSearchParams());

test('history order: the day first, then creation time, then key', () => {
  const list = [
    it('a', '2026-01-01', '2026-01-05T10:00:00.000Z'),
    it('b', '2026-01-02', '2026-01-02T08:00:00.000Z'),
    it('c', '2026-01-02', '2026-01-02T09:00:00.000Z'),
    it('d', '2026-01-02', '2026-01-02T09:00:00.000Z'),
  ].sort(compareHistory);
  assert.deepEqual(list.map((x) => x.key), ['d', 'c', 'b', 'a']);
});

test('cursor round trip; bad cursors are ignored', () => {
  const c = { date: '2026-01-02', created_at: '2026-01-02T09:00:00.000Z', key: 'm-1|x' };
  assert.deepEqual(parseCursor(encodeCursor(c)), c);
  assert.equal(parseCursor('nonsense'), null);
  assert.equal(parseCursor('2026-13-45|x|k'), null);
  assert.equal(parseCursor(null), null);
});

test('pages: exact boundary, no duplicates, next cursor only when more exists', () => {
  const a = [it('a1', '2026-01-03', '2026-01-03T10:00:00.000Z'), it('a2', '2026-01-01', '2026-01-01T10:00:00.000Z')];
  const b = [it('b1', '2026-01-02', '2026-01-02T10:00:00.000Z'), it('a1', '2026-01-03', '2026-01-03T10:00:00.000Z')];
  const p1 = mergePage([a, b], 2, null, none);
  assert.deepEqual(p1.items.map((x) => x.key), ['a1', 'b1']);
  assert.ok(p1.next);
  const p2 = mergePage([a, b], 2, parseCursor(p1.next), none);
  assert.deepEqual(p2.items.map((x) => x.key), ['a2']);
  assert.equal(p2.next, null);
});

test('filters: type, section, author, dates', () => {
  const f = parseFilter(new URLSearchParams('types=meal,nope&author=link&from=2026-01-01&to=2026-01-31&sections=nutrition'));
  assert.deepEqual([f.types, f.sections, f.author, f.from, f.to], [['meal'], ['nutrition'], 'link', '2026-01-01', '2026-01-31']);
  assert.ok(filterActive(f));
  assert.equal(filterActive(none), false);
  const meal = it('meal-1', '2026-01-10', '2026-01-10T10:00:00.000Z', { type: 'meal', section: 'nutrition', author: 'link' });
  assert.ok(matches(meal, f));
  assert.equal(matches({ ...meal, author: 'coach' }, f), false);
  assert.equal(matches({ ...meal, date: '2026-02-01' }, f), false);
});

test('a share link sees only its sections, never reports (sections follow the link permissions)', () => {
  const perms = resolvePermissions('edit', { see: { nutrition: false, technical: false } });
  assert.deepEqual(sectionsForLink(perms), ['progress', 'biometrics', 'fitness', 'timeline']);
  assert.deepEqual(sectionsForLink(defaultPermissions('view')), ['technical', 'progress', 'biometrics', 'fitness', 'nutrition', 'timeline']);
});

test('items keep stable keys: an entry copied from an old progress value keeps that value’s key', () => {
  const tracker = { id: 't1', name: 'Weight', category: 'biometrics', mode: 'single' as const, fields: [{ id: 'weight', label: 'Weight', kind: 'weight' as const, unit: 'kg' }] };
  const base = { id: 'e1', tracker_id: 't1', entry_date: '2026-01-10', measurements: { weight: 72 }, sets: null, note: '', author: 'coach' as const, status: 'approved' as const, created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-10T08:00:00Z' };
  const copied = itemFromTrackerEntry({ ...base, legacy_metric_id: 'old-1' }, tracker);
  assert.equal(copied.key, 'm-old-1');
  assert.equal(itemFromMetric({ id: 'old-1', name: 'Weight', unit: 'kg', value: 72, recorded_on: '2026-01-10' }).key, 'm-old-1');
  const fresh = itemFromTrackerEntry(base, tracker);
  assert.equal(fresh.key, 't-e1');
  assert.equal(fresh.section, 'biometrics');
  assert.match(fresh.body ?? '', /72 kg/);
  assert.equal(itemFromTimeline({ id: 'x', kind: 'note', body: 'hi', media_url: null, youtube_id: null, created_at: '2026-01-01T10:00:00Z' })?.key, 'i-x');
});

test('meals, plans and technical comments become readable items', () => {
  const meal = itemFromMeal({ id: 'm', eaten_on: '2026-01-10', eaten_at: '12:30:00', category: 'lunch', description: 'Rice', calories: 600, protein_g: 30, carbs_g: null, fat_g: null, photo_url: null, note: '', author: 'link', status: 'submitted', created_at: '2026-01-10T12:40:00Z' });
  assert.equal(meal.title, 'Lunch · 12:30');
  assert.match(meal.body ?? '', /600 kcal · P 30 g/);
  assert.equal(meal.status, 'submitted');
  const plan = itemFromPlan({ id: 'p', title: 'February', starts_on: '2026-02-01', ends_on: null, previous_id: 'p0', targets: { calories: 2500 }, created_at: '2026-01-20T10:00:00Z' });
  assert.equal(plan.date, '2026-02-01');
  assert.equal(plan.title, 'New version of the nutrition plan: February');
  const sheet = itemsFromSheet([{ label: 'Forehand', kind: 'track', entries: [{ id: 'f1', date: '2026-01-03', text: 'Late contact' }, { id: 'f2', date: 'bad', text: 'x' }] }, { label: 'Nationality', entries: [] }]);
  assert.deepEqual(sheet.map((x) => [x.key, x.title, x.body]), [['ts-f1', 'Forehand', 'Late contact']]);
});

test('a one-value tracker named like its value does not repeat the name in the text', () => {
  const t = { id: 't2', name: 'Serve speed', category: 'progress', mode: 'single' as const, fields: [{ id: 'value', label: 'Serve speed', kind: 'speed' as const, unit: 'km/h' }] };
  const e = { id: 'e2', tracker_id: 't2', entry_date: '2026-01-10', measurements: { value: 172 }, sets: null, note: '', author: 'coach' as const, status: 'approved' as const, created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-10T08:00:00Z' };
  const item = itemFromTrackerEntry(e, t);
  assert.equal(item.title, 'Serve speed');
  assert.equal(item.body, '172 km/h');
  const other = itemFromTrackerEntry(e, { ...t, fields: [{ ...t.fields[0], label: 'Speed' }] });
  assert.equal(other.body, 'Speed 172 km/h');
});
