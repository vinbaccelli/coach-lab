import test from 'node:test';
import assert from 'node:assert/strict';
import { livePlayerMask } from '../lib/stroMotionDraft/liveOcclusion';

const W = 40, H = 40;
const flat = (v: number) => { const a = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { a[i * 4] = v; a[i * 4 + 1] = v; a[i * 4 + 2] = v; a[i * 4 + 3] = 255; } return a; };
const paint = (img: Uint8ClampedArray, x0: number, y0: number, s: number, v: number) => {
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { const o = (y * W + x) * 4; img[o] = v; img[o + 1] = v; img[o + 2] = v; }
};
const at = (m: { alpha: Uint8ClampedArray }, x: number, y: number) => m.alpha[y * W + x];

test('the live player is the area that differs from the clean plate; the background stays 0', () => {
  const plate = flat(100);
  const live = flat(100);
  paint(live, 15, 15, 10, 220); // the player
  const m = livePlayerMask(live, plate, W, H);
  assert.equal(m.reliable, true);
  assert.ok(at(m, 20, 20) > 240, 'inside the player');
  assert.equal(at(m, 2, 2), 0, 'far background');
  assert.ok(at(m, 14, 20) > 100, 'the grown edge also stops a layer peeking out');
  assert.equal(at(m, 5, 20), 0);
});

test('video noise (a few isolated pixels) is not treated as a player', () => {
  const plate = flat(100);
  const live = flat(100);
  paint(live, 5, 5, 1, 200); paint(live, 30, 8, 1, 200); paint(live, 12, 33, 1, 200);
  const m = livePlayerMask(live, plate, W, H);
  assert.equal(m.reliable, true);
  assert.equal(Math.max(...m.alpha), 0);
});

test('a camera move (almost everything differs) is unreliable and gives an empty mask, so layers fall back to the front', () => {
  const m = livePlayerMask(flat(180), flat(100), W, H);
  assert.equal(m.reliable, false);
  assert.ok(m.coverage > 0.9);
  assert.equal(Math.max(...m.alpha), 0);
});

test('small brightness drift stays below the threshold', () => {
  const m = livePlayerMask(flat(112), flat(100), W, H);
  assert.equal(m.reliable, true);
  assert.equal(Math.max(...m.alpha), 0);
});
