import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateExportBytes, EXPORT_AUDIO_BPS, exportQualityOptions, formatMegabytes, originalVideoBps, scaledExportSize, TIER_VIDEO_BPS,
} from '@/lib/exportEstimate';

test('estimate is (video + audio bits/s) × duration ÷ 8', () => {
  assert.equal(estimateExportBytes(10, 4_000_000, 128_000), 5_160_000);
  assert.equal(estimateExportBytes(60, 8_000_000), Math.round(((8_000_000 + EXPORT_AUDIO_BPS) * 60) / 8));
  assert.equal(estimateExportBytes(1, 16_000_000, 0), 2_000_000);
});

test('estimate follows the trim (duration) and the quality (bitrate) live', () => {
  const whole = estimateExportBytes(30, TIER_VIDEO_BPS['1080p']);
  const half = estimateExportBytes(15, TIER_VIDEO_BPS['1080p']);
  const lower = estimateExportBytes(30, TIER_VIDEO_BPS['720p']);
  assert.ok(half < whole && Math.abs(half * 2 - whole) <= 1);
  assert.ok(lower < whole);
  assert.ok(estimateExportBytes(30, TIER_VIDEO_BPS.above1080p) > whole);
});

test('estimate is zero for an empty or invalid range, never negative or NaN', () => {
  assert.equal(estimateExportBytes(0, 8_000_000), 0);
  assert.equal(estimateExportBytes(-5, 8_000_000), 0);
  assert.equal(estimateExportBytes(Number.NaN, 8_000_000), 0);
  assert.equal(estimateExportBytes(Number.POSITIVE_INFINITY, 8_000_000), 0);
  assert.equal(estimateExportBytes(10, Number.NaN, Number.NaN), 0);
});

test('presets above the source size are disabled (never upscale)', () => {
  const [p720, p1080, orig] = exportQualityOptions(1280, 720);
  assert.equal(p720.disabled, false);
  assert.equal(p1080.disabled, true);
  assert.equal(orig.disabled, false);
  const small = exportQualityOptions(640, 360);
  assert.deepEqual(small.map((o) => o.disabled), [true, true, false]);
  const hd = exportQualityOptions(1920, 1080);
  assert.deepEqual(hd.map((o) => o.disabled), [false, false, false]);
});

test('landscape 4K: 720p and 1080p scale the height, Original keeps the size', () => {
  const [p720, p1080, orig] = exportQualityOptions(3840, 2160);
  assert.deepEqual([p720.width, p720.height, p720.maxHeight], [1280, 720, 720]);
  assert.deepEqual([p1080.width, p1080.height, p1080.maxHeight], [1920, 1080, 1080]);
  assert.deepEqual([orig.width, orig.height, orig.maxHeight], [3840, 2160, null]);
  assert.deepEqual([p720.videoBitsPerSecond, p1080.videoBitsPerSecond, orig.videoBitsPerSecond], [4_000_000, 8_000_000, 16_000_000]);
});

test('portrait phone clip: the preset names the SHORT side', () => {
  const [p720, p1080, orig] = exportQualityOptions(1080, 1920);
  assert.deepEqual([p720.width, p720.height], [720, 1280]);
  assert.equal(p1080.disabled, false);
  assert.deepEqual([p1080.width, p1080.height], [1080, 1920]);
  assert.deepEqual([orig.width, orig.height], [1080, 1920]);
});

test('Original uses the bitrate of the tier its short side falls in', () => {
  assert.equal(originalVideoBps(640, 360), 4_000_000);
  assert.equal(originalVideoBps(1280, 720), 4_000_000);
  assert.equal(originalVideoBps(1920, 1080), 8_000_000);
  assert.equal(originalVideoBps(1080, 1920), 8_000_000);
  assert.equal(originalVideoBps(2560, 1440), 16_000_000);
});

test('scaledExportSize: even sizes, no cap keeps the source, a cap keeps the aspect', () => {
  assert.deepEqual(scaledExportSize(1921, 1081), { width: 1920, height: 1080 });
  assert.deepEqual(scaledExportSize(1920, 1080, null), { width: 1920, height: 1080 });
  assert.deepEqual(scaledExportSize(1920, 1080, 2000), { width: 1920, height: 1080 });
  assert.deepEqual(scaledExportSize(1920, 1080, 720), { width: 1280, height: 720 });
  const odd = scaledExportSize(1000, 750, 481);
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height % 2, 0);
});

test('formatMegabytes shows decimal megabytes', () => {
  assert.equal(formatMegabytes(5_160_000), '5.2 MB');
  assert.equal(formatMegabytes(0), '0.0 MB');
  assert.equal(formatMegabytes(20_000), '< 0.1 MB');
  assert.equal(formatMegabytes(123_456_789), '123 MB');
});
