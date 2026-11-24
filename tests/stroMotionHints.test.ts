import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFrameTime, generateDisabledReason } from '../lib/stroMotionHints';

test('frame times are rounded to hundredths, not cut off', () => {
  assert.equal(formatFrameTime(3.199), '0:03.20');
  assert.equal(formatFrameTime(3.496), '0:03.50');
  assert.equal(formatFrameTime(1.2), '0:01.20');
  assert.equal(formatFrameTime(59.996), '1:00.00'); // carries into the minute
  assert.equal(formatFrameTime(0), '0:00.00');
  assert.equal(formatFrameTime(NaN), '0:00.00');
  assert.equal(formatFrameTime(-1), '0:00.00');
});

test('the disabled Generate button says why', () => {
  const base = { isGenerating: false, isProposingFrame: false, frameCount: 8, readyCount: 8 };
  assert.equal(generateDisabledReason(base), '');
  assert.match(generateDisabledReason({ ...base, disabled: true }), /Upload a video/);
  assert.match(generateDisabledReason({ ...base, isGenerating: true }), /Generating/);
  assert.match(generateDisabledReason({ ...base, isProposingFrame: true }), /Finding the player/);
  assert.match(generateDisabledReason({ ...base, frameCount: 0, readyCount: 0 }), /Add frames/);
  const r = generateDisabledReason({ ...base, readyCount: 3 });
  assert.match(r, /5 of 8 frames/);
  assert.match(r, /AI auto-detect/);
});
