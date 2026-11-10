import test from 'node:test';
import assert from 'node:assert/strict';
import { isIosUserAgent, pickStroVideoMime } from '../lib/stroMotion';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPAD_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

test('isIosUserAgent: iPhone and iPadOS-as-Mac are iOS, desktop Mac is not', () => {
  assert.equal(isIosUserAgent(IPHONE), true);
  assert.equal(isIosUserAgent(IPAD_MAC_UA), true);
  assert.equal(isIosUserAgent(DESKTOP), false);
});

test('pickStroVideoMime: iOS takes MP4 even when the recorder also offers WebM (Files cannot open WebM)', () => {
  const both = (t: string) => t.startsWith('video/webm') || t.startsWith('video/mp4');
  assert.equal(pickStroVideoMime(both, IPHONE), 'video/mp4;codecs=avc1.42E01E');
  assert.equal(pickStroVideoMime((t) => t === 'video/mp4', IPHONE), 'video/mp4');
});

test('pickStroVideoMime: elsewhere WebM stays first; MP4 only as the last resort', () => {
  const both = (t: string) => t.startsWith('video/webm') || t.startsWith('video/mp4');
  assert.equal(pickStroVideoMime(both, DESKTOP), 'video/webm;codecs=vp9');
  assert.equal(pickStroVideoMime((t) => t === 'video/webm', DESKTOP), 'video/webm');
  assert.equal(pickStroVideoMime(() => false, DESKTOP), 'video/mp4');
  assert.equal(pickStroVideoMime((t) => t === 'video/webm', IPHONE), 'video/webm', 'iOS without any MP4 recorder still records something');
});
