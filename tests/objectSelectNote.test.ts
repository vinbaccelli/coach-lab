import test from 'node:test';
import assert from 'node:assert/strict';
import { objectSelectUnavailableNote } from '../lib/stroMotionDraft/objectSelectNote';

test('an out-of-memory failure says so, says it is not the video size, and offers the brushes', () => {
  const n = objectSelectUnavailableNote('model load failed: no available backend found. ERR: [wasm] RangeError: Out of memory');
  assert.match(n, /more memory than this phone has free/);
  assert.match(n, /does not depend on the video size/);
  assert.match(n, /Add, Remove and Flood/);
  assert.doesNotMatch(n, /RangeError/);
});

test('any other failure keeps the plain message with the reason (capped)', () => {
  assert.equal(objectSelectUnavailableNote(''), 'Object select unavailable — the segmenter could not load on this machine.');
  assert.match(objectSelectUnavailableNote('404 /models/sam2/x.onnx'), /Reason: 404 \/models\/sam2\/x\.onnx$/);
  assert.ok(objectSelectUnavailableNote('x'.repeat(500)).length < 260);
});
