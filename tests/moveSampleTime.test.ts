import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSampleTime } from '../lib/stroMotion';

const T = [1, 2, 3, 4, 5];

test('moves one stop and leaves the others exactly where they were', () => {
  assert.deepEqual(moveSampleTime(T, 2, 2.5, 0, 6), [1, 2, 2.5, 4, 5]);
});

test('dragging right past the neighbour stops at it (a gap before it) and does not push it', () => {
  const r = moveSampleTime(T, 1, 4.9, 0, 6);
  assert.deepEqual(r.filter((_, i) => i !== 1), [1, 3, 4, 5]);
  assert.ok(r[1] < 3 && r[1] > 2.9);
});

test('dragging left past the neighbour stops at it and does not push it', () => {
  const r = moveSampleTime(T, 3, 0.2, 0, 6);
  assert.deepEqual(r.filter((_, i) => i !== 3), [1, 2, 3, 5]);
  assert.ok(r[3] > 3 && r[3] < 3.1);
});

test('the first and last stops are kept inside the trim', () => {
  assert.equal(moveSampleTime(T, 0, -5, 0.5, 6)[0], 0.5);
  assert.equal(moveSampleTime(T, 4, 99, 0, 5.5)[4], 5.5);
});

test('a bad index changes nothing', () => {
  assert.deepEqual(moveSampleTime(T, 9, 2, 0, 6), T);
});
