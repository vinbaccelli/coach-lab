import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldForcePause } from '../lib/firstFrame';

test('a video still playing after the prime, with no press since, is paused', () => {
  assert.equal(shouldForcePause({ paused: false, lastGestureAt: 100, settleStartedAt: 500 }), true);
});

test('a video the person started after the prime is left playing', () => {
  assert.equal(shouldForcePause({ paused: false, lastGestureAt: 600, settleStartedAt: 500 }), false);
});

test('a paused video is left alone', () => {
  assert.equal(shouldForcePause({ paused: true, lastGestureAt: 0, settleStartedAt: 500 }), false);
});
