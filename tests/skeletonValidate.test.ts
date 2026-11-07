import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrack, INVALID_SCORE } from '../lib/skeletonValidate';
import { smoothBakedTrack } from '../lib/trackSmoothing';
import { compareToTruth, LR_PAIRS, type Seq } from '../lib/skeletonBench/metrics';
import {
  synthSwing, injectOutliers, injectSwaps, mulberry32, toTrackSamples, fromTrackSamples,
} from '../lib/skeletonBench/synthetic';

const truth = (kind: 'forehand' | 'serve' | 'lateral', fps = 60) =>
  synthSwing({ kind, frames: Math.round(1.5 * fps), fps }) as Seq;
const run = (s: Seq, fps: number) => validateTrack(toTrackSamples(s, fps));
const back = (r: ReturnType<typeof run>) => fromTrackSamples(r.samples);

test('genuine fast swings are never invalidated or "repaired" (forehand, serve, lateral @60 and @30 fps)', () => {
  for (const fps of [60, 30]) for (const k of ['forehand', 'serve', 'lateral'] as const) {
    const r = run(truth(k, fps), fps);
    assert.deepEqual(
      { s: r.report.swapsFixed, a: r.report.invalidLowScore, b: r.report.invalidOutlier, c: r.report.invalidBone },
      { s: 0, a: 0, b: 0, c: 0 }, `${k}@${fps}`);
  }
});

test('validation adds no smoothing: truth passes through unchanged, wrist peak ratio exactly 1', () => {
  const t = truth('forehand');
  const c = compareToTruth(back(run(t, 60)), t);
  assert.equal(c.meanError, 0);
  assert.equal(c.wristPeakRatio, 1);
});

test('confident-but-wrong joints (vis 0.25 teleports) are caught: visible error collapses', () => {
  const t = truth('forehand');
  const bad = injectOutliers(t, 0.15, 220, mulberry32(5));
  const r = run(bad, 60);
  const before = compareToTruth(bad, t, 'right_wrist', 0.2);
  const after = compareToTruth(back(r), t, 'right_wrist', 0.2);
  console.log('[validate] outliers: invalid', r.report.invalidOutlier + r.report.invalidBone + r.report.invalidLowScore,
    '| visible maxErr', before.maxError.toFixed(3), '→', after.maxError.toFixed(3),
    '| p95', before.p95Error.toFixed(3), '→', after.p95Error.toFixed(3));
  assert.ok(before.maxError > 0.3);
  assert.ok(after.maxError < 0.1, `after maxErr ${after.maxError}`);
});

test('single-frame and persistent L/R swaps are repaired', () => {
  const t = truth('lateral');
  const spot = injectSwaps(t, [30, 31, 32, 60], LR_PAIRS);
  const r1 = run(spot, 60);
  assert.equal(compareToTruth(back(r1), t).swapsVsTruth, 0);
  assert.ok(r1.report.swapsFixed > 0);

  const persistent = injectSwaps(t, Array.from({ length: 40 }, (_, i) => 50 + i), [['left_knee', 'right_knee'], ['left_ankle', 'right_ankle']]);
  const r2 = run(persistent, 60);
  assert.equal(compareToTruth(back(r2), t).swapsVsTruth, 0);
});

test('low-confidence joints are capped (shown as unknown), not moved or deleted', () => {
  const t = truth('serve');
  const s = toTrackSamples(t, 60);
  const k = s[20].kps.find((x) => x.name === 'left_wrist')!;
  const x0 = k.x; k.score = 0.1;
  const r = validateTrack(s);
  const o = r.samples[20].kps.find((x) => x.name === 'left_wrist')!;
  assert.ok(o.score <= INVALID_SCORE);
  assert.equal(o.x, x0);
  assert.equal(r.report.invalidLowScore, 1);
});

test('input is not mutated; short tracks are returned as-is', () => {
  const s = toTrackSamples(truth('forehand'), 60);
  const snap = JSON.stringify(s);
  validateTrack(s);
  assert.equal(JSON.stringify(s), snap);
  const tiny = s.slice(0, 3);
  assert.equal(validateTrack(tiny).samples, tiny);
});

test('outliers: validate+smooth is equivalent to smooth-only (smoother already repairs them) — same peak retention, no added smoothing', () => {
  const t = truth('forehand');
  const bad = injectOutliers(t, 0.15, 220, mulberry32(9));
  const smoothOnly = fromTrackSamples(smoothBakedTrack(toTrackSamples(bad, 60)));
  const both = fromTrackSamples(smoothBakedTrack(validateTrack(toTrackSamples(bad, 60)).samples));
  const a = compareToTruth(smoothOnly, t, 'right_wrist', 0.2), b = compareToTruth(both, t, 'right_wrist', 0.2);
  console.log('[validate+smooth] visible meanErr', a.meanError.toFixed(5), '→', b.meanError.toFixed(5),
    '| maxErr', a.maxError.toFixed(3), '→', b.maxError.toFixed(3), '| peak', a.wristPeakRatio.toFixed(3), '→', b.wristPeakRatio.toFixed(3));
  assert.ok(Math.abs(b.meanError - a.meanError) < 0.001);
  assert.ok(b.maxError <= a.maxError + 1e-9);
  assert.ok(Math.abs(b.wristPeakRatio - a.wristPeakRatio) < 0.03, 'must not add smoothing');
});

test('L/R swaps: the smoother cannot repair them, validate+smooth does', () => {
  const t = truth('lateral');
  const bad = injectSwaps(t, Array.from({ length: 30 }, (_, i) => 40 + i), LR_PAIRS);
  const smoothOnly = fromTrackSamples(smoothBakedTrack(toTrackSamples(bad, 60)));
  const both = fromTrackSamples(smoothBakedTrack(validateTrack(toTrackSamples(bad, 60)).samples));
  const a = compareToTruth(smoothOnly, t), b = compareToTruth(both, t);
  console.log('[validate+smooth] swaps vs truth', a.swapsVsTruth, '→', b.swapsVsTruth, '| meanErr', a.meanError.toFixed(4), '→', b.meanError.toFixed(4));
  assert.ok(a.swapsVsTruth > 20);
  assert.equal(b.swapsVsTruth, 0);
  assert.ok(b.meanError < a.meanError);
});

import { refineBakedTrack, LEGACY_SKELETON_KEY } from '../lib/skeletonRefine';

test('refineBakedTrack: legacy flag = previous smoothing-only path; default = validate then smooth', () => {
  const t = truth('lateral');
  const bad = injectSwaps(t, Array.from({ length: 30 }, (_, i) => 40 + i), LR_PAIRS);
  const s = toTrackSamples(bad, 60);
  assert.deepEqual(refineBakedTrack(s, true), smoothBakedTrack(s));
  const fixed = fromTrackSamples(refineBakedTrack(s, false));
  assert.equal(compareToTruth(fixed, t).swapsVsTruth, 0);
  assert.equal(LEGACY_SKELETON_KEY, 'anglemotion:skeleton-legacy');
});

import { crossClassJumps } from '../lib/skeletonBench/metrics';
import { injectLayoutSwap } from '../lib/skeletonBench/synthetic';

test('frame gate: clean fast swings are never dropped (forehand/serve/lateral @60 and @30)', () => {
  for (const fps of [60, 30]) for (const k of ['forehand', 'serve', 'lateral'] as const) {
    assert.equal(run(truth(k, fps), fps).report.droppedFrames, 0, `${k}@${fps}`);
  }
});

test('frame gate: a sustained "legs as arms" layout is dropped, neighbours are kept', () => {
  const t = truth('lateral');
  const frames = Array.from({ length: 16 }, (_, i) => 30 + i); // 30..45
  const bad = injectLayoutSwap(t, frames);
  const r = run(bad, 60);
  const droppedIdx = r.dropped.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  const hit = droppedIdx.filter((i) => frames.includes(i)).length;
  console.log('[frame gate] injected', frames.length, '→ dropped', droppedIdx.length, '(of which injected', hit + ')');
  assert.ok(hit >= 14, `only ${hit}/16 injected frames dropped`);
  assert.ok(droppedIdx.length - hit <= 1, 'at most one innocent neighbour dropped');
  assert.ok(crossClassJumps(bad).armToLeg + crossClassJumps(bad).legToArm > 0, 'metric sees the corruption');
});

test('refineBakedTrack drops implausible frames before smoothing and leaves no cross-limb jumps', () => {
  const t = truth('lateral');
  const bad = injectLayoutSwap(t, Array.from({ length: 16 }, (_, i) => 30 + i));
  const s = toTrackSamples(bad, 60);
  const legacy = fromTrackSamples(refineBakedTrack(s, true));
  const fixed = fromTrackSamples(refineBakedTrack(s, false));
  const a = crossClassJumps(legacy), b = crossClassJumps(fixed);
  console.log('[refine] cross-limb jumps legacy', a.armToLeg + a.legToArm, '→ new', b.armToLeg + b.legToArm, '| frames', legacy.length, '→', fixed.length);
  assert.ok(a.armToLeg + a.legToArm > 0);
  assert.equal(b.armToLeg + b.legToArm, 0);
  assert.ok(fixed.length < legacy.length);
});

test('frame gate does not fire on foreshortening or a squat (serve loading, arms toward camera)', () => {
  // arms at 40 % length (pointing at the camera) and legs at 70 % (knee bend): still arm < leg
  const t = truth('serve');
  const squat = t.map((p) => {
    if (!p) return p;
    const q = JSON.parse(JSON.stringify(p));
    for (const side of ['left', 'right']) {
      const sh = q[`${side}_shoulder`], el = q[`${side}_elbow`], wr = q[`${side}_wrist`];
      el.x = sh.x + (el.x - sh.x) * 0.4; el.y = sh.y + (el.y - sh.y) * 0.4;
      wr.x = el.x + (wr.x - p[`${side}_elbow`].x) * 0.4; wr.y = el.y + (wr.y - p[`${side}_elbow`].y) * 0.4;
      const hp = q[`${side}_hip`], kn = q[`${side}_knee`], an = q[`${side}_ankle`];
      kn.x = hp.x + (kn.x - hp.x) * 0.7; kn.y = hp.y + (kn.y - hp.y) * 0.7;
      an.x = kn.x + (an.x - p[`${side}_knee`].x) * 0.7; an.y = kn.y + (an.y - p[`${side}_knee`].y) * 0.7;
    }
    return q;
  }) as Seq;
  assert.equal(run(squat, 60).report.droppedFrames, 0);
});

test('frame gate: a rotated (sideways) clip is not dropped wholesale by the vertical-order rule', () => {
  const t = truth('forehand');
  const rotated = t.map((p) => {
    if (!p) return p;
    return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { x: v.y, y: -v.x, vis: v.vis }]));
  }) as Seq;
  assert.equal(run(rotated, 60).report.droppedFrames, 0);
});
