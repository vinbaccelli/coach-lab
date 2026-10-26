import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_EARLY_FAIL_DETECTIONS, ANALYSIS_EVAL_FRAMES, ANALYSIS_START_RATE, analysisEstimateSec, nextLowerRate, PlaybackCollector,
} from '../lib/playbackAnalysis';

const kp = (x: number) => [{ x, y: 10, score: 0.9, name: 'left_wrist' }];

test('rates step down 0.25 → 0.15 → 0.1 and stop', () => {
  assert.equal(ANALYSIS_START_RATE, 0.25);
  assert.equal(nextLowerRate(0.25), 0.15);
  assert.equal(nextLowerRate(0.15), 0.1);
  assert.equal(nextLowerRate(0.1), null);
  assert.equal(nextLowerRate(1), 0.25);
});

test('every frame is detected while the detector is free; busy frames are skipped, not queued', () => {
  const c = new PlaybackCollector({ start: 2, end: 6 });
  assert.equal(c.onFrame(2.0, false), 'detect');
  assert.equal(c.onFrame(2.033, true), 'skip');
  assert.equal(c.onFrame(2.066, false), 'detect');
  assert.deepEqual(c.stats(), { frames: 3, skipped: 1, detections: 2, withPose: 0 });
});

test('frames before the range are ignored, the first frame at or after the end finishes', () => {
  const c = new PlaybackCollector({ start: 2, end: 6 });
  assert.equal(c.onFrame(0.5, false), 'skip');
  assert.equal(c.stats().frames, 0);
  assert.equal(c.onFrame(5.99, false), 'detect');
  assert.equal(c.onFrame(6.0, false), 'done');
});

test('samples: only poses, inside the range (+0.1 s), sorted, one per media time', () => {
  const c = new PlaybackCollector({ start: 2, end: 6 });
  c.record(3.0, kp(30)); c.record(2.5, kp(25)); c.record(2.5, kp(26)); c.record(4, null); c.record(9, kp(90)); c.record(1.95, kp(19));
  const s = c.samples();
  assert.deepEqual(s.map((x) => x.t), [1.95, 2.5, 3.0]);
  assert.equal(s[1].kps[0].x, 25);
});

test('rate advice: slower only when a full window skipped more than a quarter of its frames', () => {
  const c = new PlaybackCollector({ start: 0, end: 100 });
  let t = 0;
  const frame = (busy: boolean) => { c.onFrame(t, busy); t += 0.03; }; // consecutive frames, no gaps
  for (let i = 0; i < ANALYSIS_EVAL_FRAMES - 1; i++) frame(false);
  assert.equal(c.rateAdvice(0.25), null, 'window not full yet');
  frame(false);
  assert.equal(c.rateAdvice(0.25), null, 'full window, nothing skipped');
  for (let i = 0; i < ANALYSIS_EVAL_FRAMES; i++) frame(i % 2 === 0); // half skipped
  assert.equal(c.rateAdvice(0.25), 0.15);
  for (let i = 0; i < ANALYSIS_EVAL_FRAMES; i++) frame(true);
  assert.equal(c.rateAdvice(0.1), null, 'already the slowest');
});

test('frames shown while a detection blocked the page are counted from the frame counter, so the rate steps down', () => {
  const c = new PlaybackCollector({ start: 0, end: 100 });
  // A slow detector: a callback only every 8th presented frame (7 missed each time).
  let presented = 10;
  let t = 1;
  for (let i = 0; i < 4; i++) { c.onFrame(t, false, presented); presented += 8; t += 8 / 30; }
  const s = c.stats();
  assert.equal(s.detections, 4);
  assert.equal(s.skipped, 21, '3 gaps × 7 missed frames');
  assert.equal(s.frames, 4 + 21);
  // 25 frames went by in the window, 21 of them missed: play slower.
  assert.equal(c.rateAdvice(0.25), 0.15);
});

test('without a frame counter, the media-time gap shows the missed frames', () => {
  const c = new PlaybackCollector({ start: 0, end: 100 });
  c.onFrame(1.0, false);
  c.onFrame(1.033, false);      // one frame apart: sets the frame interval
  c.onFrame(1.033 + 5 * 0.0333, false); // five frames later: four missed
  const s = c.stats();
  assert.equal(s.skipped, 4);
  assert.equal(s.frames, 3 + 4);
});

test('no player: stops early only after enough detections without a single pose', () => {
  const c = new PlaybackCollector({ start: 0, end: 100 });
  for (let i = 0; i < ANALYSIS_EARLY_FAIL_DETECTIONS - 1; i++) c.onFrame(i * 0.1, false);
  assert.equal(c.noPlayerYet, false);
  c.onFrame(50, false);
  assert.equal(c.noPlayerYet, true);
  const d = new PlaybackCollector({ start: 0, end: 100 });
  d.record(0.1, kp(1));
  for (let i = 0; i < ANALYSIS_EARLY_FAIL_DETECTIONS + 5; i++) d.onFrame(i * 0.1, false);
  assert.equal(d.noPlayerYet, false, 'one pose is enough');
});

test('progress and estimate', () => {
  const c = new PlaybackCollector({ start: 2, end: 6 });
  assert.equal(c.progress(4), 0.5);
  assert.equal(c.progress(0), 0);
  assert.equal(c.progress(9), 1);
  assert.equal(analysisEstimateSec(5), 22); // 5 s / 0.25 + 2
  assert.equal(analysisEstimateSec(5, 0.1), 52);
});
