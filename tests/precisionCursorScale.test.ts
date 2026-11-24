import test from 'node:test';
import assert from 'node:assert/strict';
import { counterZoomScale } from '../lib/precisionCursorScale';

test('on-screen size (zoom * counter scale) is 1 at every zoom', () => {
  for (const z of [0.5, 1, 1.5, 2.2, 4, 8]) assert.ok(Math.abs(z * counterZoomScale(z) - 1) < 1e-9);
});

test('a bad zoom value falls back to no scaling', () => {
  for (const z of [0, -1, NaN, Infinity]) assert.equal(counterZoomScale(z), 1);
});
