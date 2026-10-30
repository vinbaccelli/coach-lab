import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampVolume, DEFAULT_SOUND, elementMuted, gainValue, isSameOriginMedia, isSilent, parseSound, soundStore,
  toggleMuteState, volumeChangeState, volumeIsWritable, volumeRoute,
} from '../lib/videoSound';

test('defaults: unmuted at full volume', () => {
  assert.deepEqual(DEFAULT_SOUND, { muted: false, volume: 1 });
  assert.equal(elementMuted(DEFAULT_SOUND), false);
  assert.equal(gainValue(DEFAULT_SOUND), 1);
});

test('mute: only the coach silences it (button, or slider at 0); there is no other input', () => {
  assert.equal(elementMuted({ muted: true, volume: 1 }), true);
  assert.equal(elementMuted({ muted: false, volume: 0 }), true);
  assert.equal(elementMuted({ muted: false, volume: 0.4 }), false);
  assert.equal(gainValue({ muted: true, volume: 0.8 }), 0);
  assert.equal(elementMuted.length, 1, 'no forced-mute parameter');
  assert.equal(gainValue.length, 1, 'no forced-mute parameter');
});

test('volume 0 to 1: clamped, and the gain follows it', () => {
  for (const v of [0.05, 0.25, 0.5, 0.75, 1]) assert.equal(gainValue({ muted: false, volume: v }), v);
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

test('controls work while recording and after it: same transitions, state kept', () => {
  soundStore.reset();
  // "recording" changes nothing about the controls: the same functions are all there is.
  let st = soundStore.get();
  st = soundStore.set(volumeChangeState(0.4));
  assert.deepEqual(st, { muted: false, volume: 0.4 });
  st = soundStore.set(toggleMuteState(st));
  assert.deepEqual(st, { muted: true, volume: 0.4 });
  assert.equal(isSilent(st), true);
  st = soundStore.set(toggleMuteState(st));
  assert.deepEqual(st, { muted: false, volume: 0.4 }, 'unmute restores the chosen volume');
  assert.deepEqual(toggleMuteState({ muted: false, volume: 0 }), { muted: false, volume: 1 });
  assert.deepEqual(volumeChangeState(0), { muted: false, volume: 0 });
  assert.equal(soundStore.get().muted, false, 'after recording the state is unchanged (nothing re-mutes)');
});

test('the choice is shared, notified and survives (session persistence format)', () => {
  soundStore.reset();
  let hits = 0;
  const off = soundStore.subscribe(() => { hits++; });
  soundStore.set({ volume: 0.3 });
  soundStore.set({ volume: 0.3 });
  soundStore.set({ muted: true });
  assert.equal(hits, 2, 'notifies on change only');
  off();
  assert.deepEqual(parseSound(JSON.stringify(soundStore.get())), { muted: true, volume: 0.3 });
  assert.deepEqual(parseSound(null), DEFAULT_SOUND);
  assert.deepEqual(parseSound('not json'), DEFAULT_SOUND);
  assert.deepEqual(parseSound('{"muted":true,"volume":9}'), { muted: true, volume: 1 });
});

test('wiring: nothing forces mute or disables the controls; play applies the state in the tap', () => {
  const tl = readFileSync('components/PreciseTimeline.tsx', 'utf8');
  const toggle = tl.slice(tl.indexOf('const togglePlay = useCallback'), tl.indexOf('const stepFrame = useCallback'));
  assert.match(toggle, /playWithSound\(/);
  assert.doesNotMatch(tl, /forceMute/);
  const ctl = readFileSync('components/SoundControls.tsx', 'utf8');
  assert.doesNotMatch(ctl, /disabled|forceMute/);
  const lib = readFileSync('lib/videoSound.ts', 'utf8');
  assert.doesNotMatch(lib, /forceMute/);
  const page = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.doesNotMatch(page, /forceMute/);
  assert.equal((page.match(/^\s+sound$/gm) ?? []).length, 2, 'both main-video timelines get the controls');
  const tap = page.slice(page.indexOf('const attemptHtml5Play'), page.indexOf('const showControls'));
  assert.match(tap, /playWithSound\(v, routeFor\(v\)\)/, 'tap-to-play uses the play button\'s sound path');
  const slotB = page.slice(page.indexOf("videoRef: videoRefB }"), page.indexOf("videoRef: videoRefB }") + 1500);
  assert.doesNotMatch(slotB.slice(0, slotB.indexOf('/>')), /^\s+sound$/m);
  const panel = readFileSync('components/metrics/MetricsExportPanel.tsx', 'utf8');
  assert.match(panel, /useSharedSound\(/);
  assert.match(panel, /export-preview/);
  const preview = panel.slice(panel.indexOf('ref={previewRef}'), panel.indexOf('onLoadedMetadata={onPreviewMeta}'));
  assert.doesNotMatch(preview, /\bmuted\b/, 'the Generate preview is not forced muted');
});
