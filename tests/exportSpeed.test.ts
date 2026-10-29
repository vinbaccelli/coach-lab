import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportOutputSeconds, nearestExportSpeed, rateCandidates, rateFallbackText, rateWorked, soundIncluded, speedLabel,
  exportAudioPlan, sourceAudioFromProbe, countAudioTracksInContainer, NO_SOUND_NOTICE,
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

test('sound: kept at every speed when the switch is on and the clip has sound; the switch decides', () => {
  for (const r of [1, 0.5, 0.25, 0.1]) {
    for (const source of ['yes', 'unknown'] as const) {
      assert.equal(soundIncluded(true, source, r), true, `${source} at ${r}×`);
      assert.equal(soundIncluded(false, source, r), false, `switch off at ${r}×`);
      const plan = exportAudioPlan({ wanted: true, source, rate: r });
      assert.equal(plan.showToggle, true);
      assert.equal(plan.notice, null);
      assert.equal(plan.preservesPitch, false, 'exported audio is not pitch-corrected');
    }
  }
});

test('a clip without sound: no switch, a notice, never included, at any speed', () => {
  for (const r of [1, 0.5, 0.25, 0.1]) {
    for (const wanted of [true, false]) {
      const plan = exportAudioPlan({ wanted, source: 'no', rate: r });
      assert.equal(plan.included, false);
      assert.equal(plan.showToggle, false);
      assert.equal(plan.notice, NO_SOUND_NOTICE);
    }
  }
  assert.equal(NO_SOUND_NOTICE, 'This clip has no sound.');
});

test('source audio is read from whichever signal the browser has (Safari, Firefox, Chrome), else unknown', () => {
  assert.equal(sourceAudioFromProbe({ audioTracks: 1 }), 'yes');
  assert.equal(sourceAudioFromProbe({ audioTracks: 0 }), 'no');
  assert.equal(sourceAudioFromProbe({ mozHasAudio: true }), 'yes');
  assert.equal(sourceAudioFromProbe({ mozHasAudio: false }), 'no');
  assert.equal(sourceAudioFromProbe({ captureStreamAudio: 2 }), 'yes');
  assert.equal(sourceAudioFromProbe({ captureStreamAudio: 0 }), 'no');
  // The first signal present wins; none present is unknown (the switch is then shown as usual).
  assert.equal(sourceAudioFromProbe({ audioTracks: 1, captureStreamAudio: 0 }), 'yes');
  assert.equal(sourceAudioFromProbe({ audioTracks: null, mozHasAudio: null, captureStreamAudio: null }), 'unknown');
  assert.equal(sourceAudioFromProbe({}), 'unknown');
});

test('audio tracks are counted from the container bytes (MP4 hdlr soun, WebM codec ids)', () => {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const box = (type: string, handler: string) => [0, 0, 0, 33, ...ascii(type), 0, 0, 0, 0, 0, 0, 0, 0, ...ascii(handler), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const mp4 = (handlers: string[]) => new Uint8Array([0, 0, 0, 24, ...ascii('ftyp'), ...ascii('isom'), 0, 0, 2, 0, ...ascii('isom'), ...handlers.flatMap((h) => box('hdlr', h))]);
  assert.equal(countAudioTracksInContainer(mp4(['vide', 'soun'])), 1);
  assert.equal(countAudioTracksInContainer(mp4(['vide'])), 0);
  assert.equal(countAudioTracksInContainer(mp4(['vide', 'soun', 'soun'])), 2);
  const webm = (codecs: string[]) => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0, 0, 0, ...codecs.flatMap((c) => [0x86, c.length, ...ascii(c)]), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(countAudioTracksInContainer(webm(['V_VP8', 'A_OPUS'])), 1);
  assert.equal(countAudioTracksInContainer(webm(['V_VP9'])), 0);
  assert.equal(countAudioTracksInContainer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])), null);
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
