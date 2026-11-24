import test from 'node:test';
import assert from 'node:assert/strict';
import { hubFinalExport, scaledExportSize, TIER_VIDEO_BPS } from '../lib/exportEstimate';

test('a 4K landscape crop is capped to 1080p with the 1080p bitrate', () => {
  const r = hubFinalExport(3840, 2160);
  assert.equal(r.maxHeight, 1080);
  assert.equal(r.videoBitsPerSecond, TIER_VIDEO_BPS['1080p']);
  assert.deepEqual(scaledExportSize(3840, 2160, r.maxHeight), { width: 1920, height: 1080 });
});
test('a tall phone crop is capped on its SHORT side, so a reel stays 1080x1920', () => {
  const r = hubFinalExport(1290, 2796);
  assert.deepEqual(scaledExportSize(1290, 2796, r.maxHeight), { width: 1080, height: 2340 });
  const reel = hubFinalExport(1080, 1920);
  assert.equal(reel.maxHeight, null);
  assert.deepEqual(scaledExportSize(1080, 1920, reel.maxHeight), { width: 1080, height: 1920 });
  assert.equal(reel.videoBitsPerSecond, TIER_VIDEO_BPS['1080p']);
});
test('never upscaled: a small crop keeps its size and the default bitrate', () => {
  const r = hubFinalExport(640, 480);
  assert.equal(r.maxHeight, null);
  assert.equal(r.videoBitsPerSecond, undefined);
});
test('a crop between 720 and 1080 keeps its size with the 1080p bitrate', () => {
  const r = hubFinalExport(1280, 900);
  assert.equal(r.maxHeight, null);
  assert.equal(r.videoBitsPerSecond, TIER_VIDEO_BPS['1080p']);
});
test('a degenerate region changes nothing', () => {
  assert.deepEqual(hubFinalExport(0, 0), { maxHeight: null, videoBitsPerSecond: undefined });
});
