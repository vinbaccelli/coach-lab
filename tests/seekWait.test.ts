import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  END_EPSILON_S, MAX_RECOVERIES, RECOVERY_WINDOW_MS, STUCK_MS,
  isPlayingStuck, nextAdvanceMark, recoveryPlan, resumeTime, seekLandedWrong, shouldAdvance, shouldRestartFromStart,
  type PlaybackSample,
} from '../lib/seekWait';

const playing = (t: number, over: Partial<PlaybackSample> = {}): PlaybackSample => ({
  paused: false, ended: false, seeking: false, readyState: 4, playbackRate: 1, currentTime: t, visible: true, ...over,
});

/** Feed samples every 250 ms through the tracker; true if any tick says stuck. */
function run(samples: PlaybackSample[]): boolean {
  let mark = null as ReturnType<typeof nextAdvanceMark> | null;
  let stuck = false;
  samples.forEach((s, i) => {
    const now = i * 250;
    if (isPlayingStuck(mark, s, now)) stuck = true;
    mark = nextAdvanceMark(mark, s, now);
  });
  return stuck;
}

test('stuck: playing, data available, time frozen for 1 s (the iPhone trace: rs=4, playing, t=0.000)', () => {
  assert.equal(run(Array.from({ length: 6 }, () => playing(0))), true);
});

test('not stuck: a healthy clip whose time advances, also at 0.1x', () => {
  assert.equal(run(Array.from({ length: 20 }, (_, i) => playing(i * 0.25))), false);
  assert.equal(run(Array.from({ length: 20 }, (_, i) => playing(i * 0.025, { playbackRate: 0.1 }))), false);
});

test('not stuck: frozen time that something explains (paused, ended, seeking, buffering, rate 0, hidden page)', () => {
  for (const over of [
    { paused: true }, { ended: true }, { seeking: true }, { readyState: 2 }, { playbackRate: 0 }, { visible: false },
  ] as Partial<PlaybackSample>[]) {
    assert.equal(shouldAdvance(playing(0, over)), false);
    assert.equal(run(Array.from({ length: 8 }, () => playing(1.5, over))), false, JSON.stringify(over));
  }
});

test('not stuck: a short start-up pause under STUCK_MS', () => {
  const n = Math.floor(STUCK_MS / 250); // frozen for less than STUCK_MS, then moving
  assert.equal(run([...Array.from({ length: n }, () => playing(0)), ...Array.from({ length: 8 }, (_, i) => playing(0.25 * (i + 1)))]), false);
});

test('seek: a seek that did not move although another time was asked is wrong (the trace: every seek ends at 0.000)', () => {
  assert.equal(seekLandedWrong({ before: 0, requested: 0.033, actual: 0, duration: 4 }), true);
  assert.equal(seekLandedWrong({ before: 2.5, requested: 1.0, actual: 2.5, duration: 4 }), true);
});

test('seek: far from the asked time is wrong; on target (rounding, a frame off) is fine', () => {
  assert.equal(seekLandedWrong({ before: 1, requested: 3, actual: 0, duration: 4 }), true);
  assert.equal(seekLandedWrong({ before: 1, requested: 1.033, actual: 1.033, duration: 4 }), false);
  assert.equal(seekLandedWrong({ before: 1, requested: 2, actual: 2.0333, duration: 4 }), false);
});

test('seek: asking past the end (or before 0) and landing on the end (or 0) is fine', () => {
  assert.equal(seekLandedWrong({ before: 3.9, requested: 5, actual: 4, duration: 4 }), false);
  assert.equal(seekLandedWrong({ before: 0.02, requested: -1, actual: 0, duration: 4 }), false);
  assert.equal(seekLandedWrong({ before: 1, requested: 1, actual: 1, duration: 4 }), false, 'a seek to where it already is');
  assert.equal(seekLandedWrong({ before: Number.NaN, requested: 1, actual: 0, duration: 4 }), false);
});

test('recovery: reload when allowed; never during recording or analysis; a message after too many resets', () => {
  assert.equal(recoveryPlan({ allowed: true, recentRecoveries: [], now: 1000 }), 'reload');
  assert.equal(recoveryPlan({ allowed: false, recentRecoveries: [], now: 1000 }), 'none');
  const many = Array.from({ length: MAX_RECOVERIES }, (_, i) => 1000 + i);
  assert.equal(recoveryPlan({ allowed: true, recentRecoveries: many, now: 5000 }), 'message');
  assert.equal(recoveryPlan({ allowed: false, recentRecoveries: many, now: 5000 }), 'none');
  assert.equal(recoveryPlan({ allowed: true, recentRecoveries: many, now: 1000 + RECOVERY_WINDOW_MS + 10 }), 'reload', 'old resets expire');
});

test('resume time: the asked time, inside the clip', () => {
  assert.equal(resumeTime(1.25, 4), 1.25);
  assert.equal(resumeTime(-2, 4), 0);
  assert.equal(resumeTime(9, 4), 4 - END_EPSILON_S);
  assert.equal(resumeTime(Number.NaN, 4), 0);
  assert.equal(resumeTime(2, Number.NaN), 2);
});

test('replay: Play on an ended video (or one parked at the last frame) starts from the start; elsewhere it resumes', () => {
  assert.equal(shouldRestartFromStart({ ended: true, currentTime: 4, duration: 4 }), true);
  assert.equal(shouldRestartFromStart({ ended: false, currentTime: 3.99, duration: 4 }), true, 'iOS: at the end, ended not set');
  assert.equal(shouldRestartFromStart({ ended: false, currentTime: 2, duration: 4 }), false);
  assert.equal(shouldRestartFromStart({ ended: false, currentTime: 0, duration: Number.NaN }), false);
});

test('wiring: timeline reports coach seeks and restarts after the end; page watches only slot A and is gated', () => {
  const tl = readFileSync('components/PreciseTimeline.tsx', 'utf8');
  assert.equal((tl.match(/reportSeekResult\(v, /g) ?? []).length, 3, 'step, tap seek, scrub end');
  const toggle = tl.slice(tl.indexOf('const togglePlay = useCallback'), tl.indexOf('const stepFrame = useCallback'));
  assert.ok(toggle.indexOf('shouldRestartFromStart(') !== -1 && toggle.indexOf('shouldRestartFromStart(') < toggle.indexOf('await v.play()'));
  const page = readFileSync('app/analysis/page.tsx', 'utf8');
  assert.equal((page.match(/watchStuckPlayback\(/g) ?? []).length, 1);
  const gate = page.slice(page.indexOf('stuckRecoveryAllowedRef.current = '), page.indexOf('stuckRecoveryAllowedRef.current = ') + 260);
  for (const flag of ['!isRecording', "precisionTrackState !== 'running'", '!stroMotionProcessing', '!generateRecording', '!replayActive', '!metricsExportOpen']) {
    assert.ok(gate.includes(flag), flag);
  }
  assert.match(page, /stuck: \$\{reason\}/, 'the trace line');
});
