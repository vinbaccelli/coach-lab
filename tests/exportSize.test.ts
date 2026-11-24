import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSize, exportBitrate } from '../lib/stroMotionDraft/fixedFpsEncoder';

test('1080p and smaller clips keep their own size', () => {
  assert.deepEqual(exportSize(1920, 1080), { w: 1920, h: 1080 });
  assert.deepEqual(exportSize(1280, 720), { w: 1280, h: 720 });
  assert.deepEqual(exportSize(1080, 1920), { w: 1080, h: 1920 });
});

test('a 4K clip is shrunk to a 1080p long edge, both sides even', () => {
  assert.deepEqual(exportSize(3840, 2160), { w: 1920, h: 1080 });
  assert.deepEqual(exportSize(2160, 3840), { w: 1080, h: 1920 });
  const odd = exportSize(2001, 1125);
  assert.equal(odd.w % 2, 0);
  assert.equal(odd.h % 2, 0);
  assert.ok(Math.max(odd.w, odd.h) <= 1920);
});

test('the bitrate follows the area and never drops below 1.5 Mbit/s', () => {
  assert.equal(exportBitrate(1920, 1080), 8_000_000);
  assert.ok(exportBitrate(1280, 720) < exportBitrate(1920, 1080));
  assert.equal(exportBitrate(320, 180), 1_500_000);
});
