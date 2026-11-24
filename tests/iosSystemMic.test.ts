import test from 'node:test';
import assert from 'node:assert/strict';
import { isIosDevice, cameraConstraints } from '../lib/iosSystemMic';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const AUDIO = { channelCount: 1 };

test('iPhone and iPadOS are iOS; a Mac and Android are not', () => {
  assert.equal(isIosDevice(IPHONE, 'iPhone', 5), true);
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh)', 'MacIntel', 5), true); // iPadOS desktop mode
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh)', 'MacIntel', 0), false);
  assert.equal(isIosDevice('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5), false);
});

test('iOS camera never requests audio (system screen recording keeps the mic)', () => {
  assert.deepEqual(cameraConstraints(true, AUDIO), { video: true });
  assert.equal('audio' in cameraConstraints(true, AUDIO), false);
});

test('other platforms keep camera + recording audio', () => {
  assert.deepEqual(cameraConstraints(false, AUDIO), { video: true, audio: AUDIO });
});
