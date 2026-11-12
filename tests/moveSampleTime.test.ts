import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSampleTimes, moveSampleTime } from '../lib/stroMotion';

const T = [1, 2, 3, 4, 5];

test('moves one stop and leaves the others exactly where they were', () => {
  assert.deepEqual(moveSampleTime(T, 2, 2.5, 0, 6), [1, 2, 2.5, 4, 5]);
});

test('a stop can be dragged PAST the others (first to the end) and none of them move', () => {
  const r = moveSampleTime(T, 0, 5.8, 0, 6);
  assert.equal(r[0], 5.8);
  assert.deepEqual(r.slice(1), [2, 3, 4, 5]);
});

test('a stop can be dragged backwards past the others too', () => {
  const r = moveSampleTime(T, 4, 0.3, 0, 6);
  assert.equal(r[4], 0.3);
  assert.deepEqual(r.slice(0, 4), [1, 2, 3, 4]);
});

test('two stops are never on the same instant: it lands just on the side it came from', () => {
  const left = moveSampleTime(T, 0, 3, 0, 6);          // comes from the left of 3
  assert.ok(left[0] < 3 && left[0] > 2.9);
  const right = moveSampleTime(T, 4, 3, 0, 6);         // comes from the right of 3
  assert.ok(right[4] > 3 && right[4] < 3.1);
  assert.deepEqual(left.slice(1), [2, 3, 4, 5]);
});

test('stops are kept inside the trim', () => {
  assert.equal(moveSampleTime(T, 0, -5, 0.5, 6)[0], 0.5);
  assert.equal(moveSampleTime(T, 4, 99, 0, 5.5)[4], 5.5);
});

test('a bad index changes nothing', () => {
  assert.deepEqual(moveSampleTime(T, 9, 2, 0, 6), T);
});

test('clamping to the trim does not reorder or move the others', () => {
  assert.deepEqual(clampSampleTimes([5, 2, 0.1, 4], 1, 4.5), [4.5, 2, 1, 4]);
});
