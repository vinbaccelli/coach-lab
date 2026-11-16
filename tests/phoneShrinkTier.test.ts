import test from 'node:test';
import assert from 'node:assert/strict';
import { shrinkTarget, lowerTier, parseTier, tierLabel, SHRINK_MAX_SECONDS } from '../lib/phoneShrink/tier';

const base = { isPhone: true, stored: null, forced: null, nativeW: 2160, nativeH: 3840, durationSec: 14 };

test('phone defaults to 1080p: a 4K portrait clip shrinks to 1080x1920', () => {
  assert.deepEqual(shrinkTarget(base), { w: 1080, h: 1920, tier: 1920 });
});
test('stored 720p tier gives 720x1280', () => {
  assert.deepEqual(shrinkTarget({ ...base, stored: 1280 }), { w: 720, h: 1280, tier: 1280 });
});
test('clip already within the tier is left alone', () => {
  assert.equal(shrinkTarget({ ...base, nativeW: 1080, nativeH: 1920 }), null);
  assert.equal(shrinkTarget({ ...base, stored: 1280, nativeW: 720, nativeH: 1280 }), null);
});
test('desktop is never shrunk, unless forced', () => {
  assert.equal(shrinkTarget({ ...base, isPhone: false }), null);
  assert.deepEqual(shrinkTarget({ ...base, isPhone: false, forced: 1280 }), { w: 720, h: 1280, tier: 1280 });
});
test('landscape 4K and odd sizes come out even', () => {
  assert.deepEqual(shrinkTarget({ ...base, nativeW: 3840, nativeH: 2160 }), { w: 1920, h: 1080, tier: 1920 });
  const t = shrinkTarget({ ...base, nativeW: 3001, nativeH: 1999 })!;
  assert.equal(t.w % 2, 0);
  assert.equal(t.h % 2, 0);
});
test('too long or unknown size: not shrunk', () => {
  assert.equal(shrinkTarget({ ...base, durationSec: SHRINK_MAX_SECONDS + 1 }), null);
  assert.equal(shrinkTarget({ ...base, nativeW: 0 }), null);
});
test('lowerTier steps down and stops at the floor; parseTier accepts labels', () => {
  assert.equal(lowerTier(1920), 1280);
  assert.equal(lowerTier(1280), 960);
  assert.equal(lowerTier(960), 960);
  assert.equal(parseTier('720'), 1280);
  assert.equal(parseTier('1080p'), 1920);
  assert.equal(parseTier('x'), null);
  assert.equal(tierLabel(1280), '720p');
});
