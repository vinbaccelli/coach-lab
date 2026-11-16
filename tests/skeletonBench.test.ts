import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackStats, compareToTruth, LR_PAIRS, bodyHeight, type Seq } from '../lib/skeletonBench/metrics';
import {
  synthSwing, addJitter, injectOutliers, injectSwaps, dropFrames, lagSeq, boxBlur, mulberry32,
} from '../lib/skeletonBench/synthetic';
import { smoothBakedTrack, type TrackSample } from '../lib/trackSmoothing';

const FPS = 60;
const truth = (kind: 'forehand' | 'serve' | 'lateral') => synthSwing({ kind, frames: 90, fps: FPS }) as Seq;

test('synthetic truth is clean: no swaps, rigid bones, stable scale', () => {
  for (const k of ['forehand', 'serve', 'lateral'] as const) {
    const s = trackStats(truth(k));
    assert.equal(s.missing, 0);
    assert.equal(s.swaps, 0, k);
    // Genuine fast swings DO exceed the 0.12 body-heights/frame "jump" threshold at 60 fps (serve wrist ≈0.15),
    // so a step-size rule alone cannot separate glitches from real motion (see docs/SKELETON_BENCH.md).
    assert.ok(s.jumpRate < 0.01, `${k} truth jumpRate ${s.jumpRate}`);
    assert.ok(s.boneLengthCV < 0.06, `${k} boneCV ${s.boneLengthCV}`);
    assert.equal(s.boneViolationRate, 0, k);
    assert.ok(Math.abs(s.bodyHeightPx - 600) < 40, `${k} bodyH ${s.bodyHeightPx}`);
  }
});

test('synthetic swing is genuinely fast (wrist ≥ 40 px/frame peak over 3 frames/3)', () => {
  const t = truth('forehand');
  const c = compareToTruth(t, t);
  assert.equal(c.meanError, 0);
  assert.equal(c.wristPeakRatio, 1);
  assert.equal(c.wristLagFrames, 0);
  let peak = 0;
  for (let i = 3; i < t.length; i++) peak = Math.max(peak, Math.hypot(t[i]!.right_wrist.x - t[i - 3]!.right_wrist.x, t[i]!.right_wrist.y - t[i - 3]!.right_wrist.y) / 3);
  assert.ok(peak > 40, `peak ${peak}`);
});

test('metrics detect injected outliers (jumps) and report them', () => {
  const t = truth('forehand');
  const bad = injectOutliers(t, 0.2, 250, mulberry32(7));
  assert.ok(trackStats(bad).jumps > trackStats(t).jumps + 5);
  assert.ok(compareToTruth(bad, t).maxError > 0.3);
});

test('metrics detect L/R swaps both with and without truth', () => {
  const t = truth('lateral');
  const bad = injectSwaps(t, [30, 31, 32, 60], LR_PAIRS);
  assert.ok(trackStats(bad).swaps >= 2, 'trackStats swaps ' + trackStats(bad).swaps);
  assert.ok(compareToTruth(bad, t).swapsVsTruth >= 4);
  assert.equal(compareToTruth(t, t).swapsVsTruth, 0);
});

test('missing frames are counted, not zero-filled', () => {
  const t = truth('serve');
  const bad = dropFrames(t, [10, 11, 12, 40]);
  const s = trackStats(bad);
  assert.equal(s.missing, 4);
  assert.equal(compareToTruth(bad, t).missing, 4);
});

test('lag is measured in frames, sign = estimate behind truth', () => {
  const t = truth('forehand');
  assert.equal(compareToTruth(lagSeq(t, 3), t).wristLagFrames, 3);
});

test('bone-length violations rise with jitter/outliers', () => {
  const t = truth('forehand');
  const jit = addJitter(t, 6, mulberry32(3));
  assert.ok(trackStats(jit).boneLengthCV > trackStats(t).boneLengthCV);
});

test('excessive smoothing is visible as lost wrist peak speed', () => {
  const t = truth('forehand');
  const light = compareToTruth(boxBlur(t, 1), t);
  const heavy = compareToTruth(boxBlur(t, 6), t);
  assert.ok(heavy.wristPeakRatio < light.wristPeakRatio);
  assert.ok(heavy.wristPeakRatio < 0.9, `heavy ratio ${heavy.wristPeakRatio}`);
});

/** Current production smoother (lib/trackSmoothing.ts) measured on synthetic truth: the Stage-2 baseline. */
const toSamples = (s: Seq): TrackSample[] =>
  s.map((p, i) => ({ t: i / FPS, kps: Object.entries(p!).map(([name, v]) => ({ name, x: v.x, y: v.y, score: v.vis ?? 0.9 })) }));
const fromSamples = (s: TrackSample[]): Seq =>
  s.map((x) => Object.fromEntries(x.kps.map((k) => [k.name, { x: k.x, y: k.y, vis: k.score }])));

test('baseline: smoothBakedTrack on noisy swing — error vs truth and peak retention (informational + sanity)', () => {
  const t = truth('forehand');
  const noisy = addJitter(t, 4, mulberry32(11));
  const sm = fromSamples(smoothBakedTrack(toSamples(noisy)));
  const raw = compareToTruth(noisy, t);
  const out = compareToTruth(sm, t);
  console.log('[baseline smoothBakedTrack] raw meanErr', raw.meanError.toFixed(4), '→', out.meanError.toFixed(4),
    '| wristPeakRatio raw', raw.wristPeakRatio.toFixed(3), '→', out.wristPeakRatio.toFixed(3), '| lag', out.wristLagFrames);
  assert.ok(out.meanError < raw.meanError, 'smoothing should reduce Gaussian-noise error');
  assert.equal(out.wristLagFrames, 0, 'centered smoothing must not add lag');
});

test('baseline: smoothBakedTrack vs injected single-frame outliers', () => {
  const t = truth('forehand');
  const bad = injectOutliers(t, 0.15, 200, mulberry32(5));
  const sm = fromSamples(smoothBakedTrack(toSamples(bad)));
  const b = trackStats(bad), a = trackStats(sm);
  console.log('[baseline smoothBakedTrack] outlier jumps', b.jumps, '→', a.jumps, '| maxErr', compareToTruth(bad, t).maxError.toFixed(3), '→', compareToTruth(sm, t).maxError.toFixed(3));
  assert.ok(a.jumps <= b.jumps);
});

test('bodyHeight ignores missing frames', () => {
  const t = truth('forehand');
  assert.ok(Math.abs(bodyHeight(dropFrames(t, [0, 1, 2])) - bodyHeight(t)) < 20);
});
