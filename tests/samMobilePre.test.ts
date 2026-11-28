import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileSamTarget, rgbaToMobileSamInput, MOBILE_SAM_SIZE, scalePoint } from '../lib/stroMotionDraft/samMobilePre';

test('target size: longest side becomes 1024, the other side keeps the aspect ratio (segment-anything rounding)', () => {
  assert.deepEqual(mobileSamTarget(1920, 1080), { width: 1024, height: 576, scale: 1024 / 1920 });
  assert.deepEqual(mobileSamTarget(540, 960), { width: 576, height: 1024, scale: 1024 / 960 });
  assert.equal(mobileSamTarget(1024, 1024).width, 1024);
});

test('input: channel-first, normalised with SAM mean/std, zero padded right/bottom', () => {
  const w = 2, h = 1;
  const rgba = [123.675, 116.28, 103.53, 255, 123.675 + 58.395, 116.28 + 57.12, 103.53 + 57.375, 255];
  const t = rgbaToMobileSamInput(rgba, w, h);
  const S = MOBILE_SAM_SIZE;
  assert.equal(t.length, 3 * S * S);
  assert.ok(Math.abs(t[0]) < 1e-5 && Math.abs(t[S * S]) < 1e-5 && Math.abs(t[2 * S * S]) < 1e-5); // pixel (0,0) = the mean -> 0
  assert.ok(Math.abs(t[1] - 1) < 1e-5 && Math.abs(t[S * S + 1] - 1) < 1e-5 && Math.abs(t[2 * S * S + 1] - 1) < 1e-5); // mean + std -> 1
  assert.equal(t[2], 0); // padding
  assert.equal(t[S], 0);
});

test('points scale with the image', () => {
  assert.deepEqual(scalePoint({ x: 100, y: 50 }, 0.5), [50, 25]);
});
