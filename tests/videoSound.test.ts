import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampVolume, DEFAULT_SOUND, elementMuted, gainValue, isSameOriginMedia, volumeIsWritable, volumeRoute,
} from '../lib/videoSound';

test('defaults: unmuted at full volume', () => {
  assert.deepEqual(DEFAULT_SOUND, { muted: false, volume: 1 });
  assert.equal(elementMuted(DEFAULT_SOUND, false), false);
  assert.equal(gainValue(DEFAULT_SOUND, false), 1);
});

test('mute: the button, a slider at 0, and recording all silence the element and the gain', () => {
  assert.equal(elementMuted({ muted: true, volume: 1 }, false), true);
  assert.equal(elementMuted({ muted: false, volume: 0 }, false), true);
  assert.equal(elementMuted({ muted: false, volume: 1 }, true), true, 'recording forces mute');
  assert.equal(gainValue({ muted: true, volume: 0.8 }, false), 0);
  assert.equal(gainValue({ muted: false, volume: 0.8 }, true), 0);
});

test('volume 0 to 1: clamped, and the gain follows it', () => {
  for (const v of [0.05, 0.25, 0.5, 0.75, 1]) assert.equal(gainValue({ muted: false, volume: v }, false), v);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(Number.NaN), 1);
});

test('route: element volume where writable; Web Audio gain on iPhone (read-only volume) for same-origin media; else none', () => {
  assert.equal(volumeRoute({ volumeWritable: true, webAudio: true, sameOrigin: true }), 'element');
  assert.equal(volumeRoute({ volumeWritable: false, webAudio: true, sameOrigin: true }), 'webaudio');
  assert.equal(volumeRoute({ volumeWritable: false, webAudio: true, sameOrigin: false }), 'none');
  assert.equal(volumeRoute({ volumeWritable: false, webAudio: false, sameOrigin: true }), 'none');
});

test('iPhone detection: a volume that ignores writes is read-only; a writable one is restored', () => {
  const ios = { get volume() { return 1; }, set volume(_v: number) { /* ignored, like iOS */ } };
  assert.equal(volumeIsWritable(ios), false);
  let stored = 0.7;
  const desktop = { get volume() { return stored; }, set volume(v: number) { stored = v; } };
  assert.equal(volumeIsWritable(desktop), true);
  assert.equal(stored, 0.7, 'restored after the probe');
});

test('same-origin media: blob, data, relative and same-origin URLs', () => {
  const o = 'https://app.example';
  assert.equal(isSameOriginMedia('blob:https://app.example/123', o), true);
  assert.equal(isSameOriginMedia('/api/video/1', o), true);
  assert.equal(isSameOriginMedia('https://app.example/v.mp4', o), true);
  assert.equal(isSameOriginMedia('https://cdn.other.com/v.mp4', o), false);
  assert.equal(isSameOriginMedia(null, o), false);
});

test('wiring: play unmutes in the tap, recording forces mute, slot B gets no sound controls', () => {
  const tl = readFileSync('components/PreciseTimeline.tsx', 'utf8');
  const toggle = tl.slice(tl.indexOf('const togglePlay = useCallback'), tl.indexOf('const stepFrame = useCallback'));
  assert.ok(toggle.indexOf('applySound(') !== -1 && toggle.indexOf('applySound(') < toggle.indexOf('await v.play()'), 'unmute before play(), inside the tap');
  const page = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.equal((page.match(/sound=\{\{ forceMute: isRecording \}\}/g) ?? []).length, 2);
  const slotB = page.slice(page.indexOf("videoRef: videoRefB }"), page.indexOf("videoRef: videoRefB }") + 1500);
  assert.doesNotMatch(slotB.slice(0, slotB.indexOf('/>')), /sound=\{\{/);
});
