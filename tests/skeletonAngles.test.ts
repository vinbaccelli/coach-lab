import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  angleAtVertex, computeSkeletonAngles, hasAnyAngle, formatAngleValue, persistableRows, SKELETON_ANGLE_LABELS,
} from '../lib/skeletonAngles';

const kp = (x: number, y: number, score = 0.9) => ({ x, y, score });
/** COCO-17 array with everything absent except what the test sets. */
const pose = (set: Record<number, ReturnType<typeof kp>>) => Array.from({ length: 17 }, (_, i) => set[i] ?? kp(0, 0, 0));

test('right angle measures 90, straight limb 180', () => {
  assert.equal(angleAtVertex(kp(0, 0), kp(10, 0), kp(0, 10)), 90);
  assert.equal(angleAtVertex(kp(0, 0), kp(10, 0), kp(-10, 0)), 180);
});

test('a genuinely folded joint is 0, NOT null', () => {
  assert.equal(angleAtVertex(kp(0, 0), kp(10, 0), kp(20, 0)), 0);
});

test('unmeasurable → null: missing point, low score, NaN, degenerate rays', () => {
  assert.equal(angleAtVertex(null, kp(1, 1), kp(2, 2)), null);
  assert.equal(angleAtVertex(kp(0, 0), undefined, kp(2, 2)), null);
  assert.equal(angleAtVertex(kp(0, 0, 0.1), kp(10, 0), kp(0, 10)), null);
  assert.equal(angleAtVertex(kp(0, 0), kp(10, 0), kp(0, 10, 0.19)), null);
  assert.equal(angleAtVertex(kp(0, 0), kp(NaN, 0), kp(0, 10)), null);
  assert.equal(angleAtVertex(kp(0, 0), kp(0.1, 0), kp(0, 0.1)), null, 'rays shorter than 1px');
});

test('computeSkeletonAngles always returns the 4 labels in order; missing ones are null', () => {
  const full = computeSkeletonAngles(pose({ 7: kp(0, 0), 5: kp(10, 0), 9: kp(0, 10) }));
  assert.deepEqual(full.map((a) => a.label), SKELETON_ANGLE_LABELS);
  assert.equal(full[0].deg, 90);
  assert.deepEqual(full.slice(1).map((a) => a.deg), [null, null, null]);
  assert.deepEqual(computeSkeletonAngles(null).map((a) => a.deg), [null, null, null, null]);
});

test('hasAnyAngle / formatAngleValue', () => {
  assert.equal(hasAnyAngle(computeSkeletonAngles(pose({}))), false);
  assert.equal(hasAnyAngle([{ label: 'L Elbow', deg: 0 }]), true, '0° is a measurement');
  assert.equal(formatAngleValue(null), '–');
  assert.equal(formatAngleValue(undefined), '–');
  assert.equal(formatAngleValue(0), '0°');
  assert.equal(formatAngleValue(137), '137°');
});

test('persistableRows strips live skeleton-angle rows and null values (never stored)', () => {
  const col = [
    { id: 'a', label: 'L Elbow', value: 90 as number | null, unit: '°', type: 'skeleton-angle' },
    { id: 'b', label: 'R Elbow', value: null as number | null, unit: '°', type: 'skeleton-angle' },
    { id: 'c', label: 'Note', value: 0 as number | null, unit: '', type: 'note' },
    { id: 'd', label: 'Bad', value: null as number | null, unit: '', type: 'angle' },
    { id: 'e', label: 'Arrow', value: 42 as number | null, unit: '°', type: 'arrowAngle' },
  ];
  assert.deepEqual(persistableRows(col).map((r) => r.id), ['c', 'e']);
});

test('regression guard: live angle rows never default unknown to 0°', () => {
  const page = readFileSync(new URL('../app/analysis/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/angleMap\.get\(label\)\s*\?\?\s*0/.test(page), 'flushAnglesToColumn must not use ?? 0');
  assert.ok(/angleMap\.get\(label\)\s*\?\?\s*null/.test(page));
});
