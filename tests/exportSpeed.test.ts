import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportOutputSeconds, nearestExportSpeed, rateCandidates, rateFallbackText, rateWorked, soundAvailable, soundIncluded, speedLabel,
} from '@/lib/exportSpeed';
import { estimateExportBytes } from '@/lib/exportEstimate';
import { outputProgress } from '@/lib/exportOverlay';

test('the default speed is the timeline rate, snapped to 1×, 0.5×, 0.25× or 0.1×', () => {
  assert.equal(nearestExportSpeed(1), 1);
  assert.equal(nearestExportSpeed(0.5), 0.5);
  assert.equal(nearestExportSpeed(0.25), 0.25);
  assert.equal(nearestExportSpeed(0.1), 0.1);
  // Timeline rates the export has no button for: nearest.
  assert.equal(nearestExportSpeed(0.05), 0.1);
  assert.equal(nearestExportSpeed(0.75), 1);
  assert.equal(nearestExportSpeed(0.6), 0.5);
  assert.equal(nearestExportSpeed(0.3), 0.25);
  // Faster than normal, or unknown: 1×.
  assert.equal(nearestExportSpeed(2), 1);
  assert.equal(nearestExportSpeed(1.5), 1);
  assert.equal(nearestExportSpeed(null), 1);
  assert.equal(nearestExportSpeed(NaN), 1);
  assert.equal(nearestExportSpeed(0), 1);
});

test('file length is range ÷ speed plus the holds; the estimate and progress follow it', () => {
  assert.equal(exportOutputSeconds(9, 1, 0), 9);
  assert.equal(exportOutputSeconds(9, 0.5, 0), 18);
  assert.equal(exportOutputSeconds(9, 0.25, 4), 40);
  assert.equal(exportOutputSeconds(9, 0.1, 0), 90);
  // Size: 0.5× doubles the media part, holds stay as they are, no audio when sound is off.
  const v = 4_000_000;
  assert.equal(estimateExportBytes(exportOutputSeconds(9, 0.5, 0), v, 0), estimateExportBytes(18, v, 0));
  assert.ok(estimateExportBytes(18, v, 0) > estimateExportBytes(9, v, 128_000));
  // Progress on the output timeline: 4.5 s of media at 0.5× = 9 s of output, of 18.
  const out = (mediaSec: number, rate: number) => mediaSec / rate;
  assert.equal(outputProgress(out(4.5, 0.5), 0, 9 / 0.5, 0), 0.5);
  assert.equal(outputProgress(out(9, 0.5), 0, 9 / 0.5, 0), 1);
});

test('sound: on at 1×, off and unavailable at any slower speed', () => {
  assert.equal(soundAvailable(1), true);
  for (const r of [0.5, 0.25, 0.1]) {
    assert.equal(soundAvailable(r), false);
    assert.equal(soundIncluded(true, r), false);
  }
  assert.equal(soundIncluded(true, 1), true);
  assert.equal(soundIncluded(false, 1), false);
});

test('fallback tries the chosen rate, then each faster export speed, ending at 1×', () => {
  assert.deepEqual(rateCandidates(0.1), [0.1, 0.25, 0.5, 1]);
  assert.deepEqual(rateCandidates(0.25), [0.25, 0.5, 1]);
  assert.deepEqual(rateCandidates(0.5), [0.5, 1]);
  assert.deepEqual(rateCandidates(1), [1]);
});

test('a probe passes only when the video moved at about the asked rate', () => {
  assert.equal(rateWorked(0.5, 0.6, 1.2), true);
  assert.equal(rateWorked(0.25, 0.31, 1.2), true);
  // Ignored rate (played at 1×), clamped rate, stalled video, no movement.
  assert.equal(rateWorked(0.25, 1.2, 1.2), false);
  assert.equal(rateWorked(0.1, 0.6, 1.2), false);
  assert.equal(rateWorked(0.5, 0, 1.2), false);
  assert.equal(rateWorked(0.5, 0.01, 1.2), false);
  assert.equal(rateWorked(0.5, -1, 1.2), false);
  assert.equal(rateWorked(0.5, 0.6, 0), false);
});

test('labels', () => {
  assert.equal(speedLabel(0.25), '0.25×');
  assert.equal(rateFallbackText(0.1, 0.5), 'This device could not play at 0.1× while exporting, so the video was exported at 0.5×.');
});
