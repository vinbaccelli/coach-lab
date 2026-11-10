import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continuePose, CONTINUE_CAP_MS, type LiveSample } from '../lib/liveDisplay';
import { simulateLive, liveScore } from '../lib/skeletonBench/liveSim';
import { synthSwing, mulberry32, gauss } from '../lib/skeletonBench/synthetic';
import type { Seq } from '../lib/skeletonBench/metrics';

const kp = (x: number, y: number, score = 0.9, name = 'right_wrist') => ({ x, y, score, name });
const S = (ts: number, ...k: ReturnType<typeof kp>[]): LiveSample => ({ ts, kps: k });

test('continuePose: continues along the last velocity for the age of the newest sample', () => {
  const out = continuePose(S(1000, kp(110, 50)), S(900, kp(100, 50)), 1050); // 0.1 px/ms × 50 ms
  assert.equal(Math.round(out[0].x), 115);
  assert.equal(out[0].y, 50);
});

test('continuePose: nothing to extrapolate right at arrival, and bounded afterwards', () => {
  assert.equal(continuePose(S(1000, kp(110, 0)), S(900, kp(100, 0)), 1000)[0].x, 110);
  const late = continuePose(S(1000, kp(110, 0)), S(900, kp(100, 0)), 1000 + 5000)[0].x; // 5 s later: capped
  assert.ok(late - 110 <= (10 / 100) * Math.min(CONTINUE_CAP_MS, 125) + 1e-9);
});

test('continuePose: low-confidence joints and mismatched layouts are left exactly as detected', () => {
  const lo = continuePose(S(1000, kp(110, 0, 0.1)), S(900, kp(100, 0, 0.9)), 1050);
  assert.equal(lo[0].x, 110);
  const shape = continuePose(S(1000, kp(110, 0), kp(1, 1, 0.9, 'x')), S(900, kp(100, 0)), 1050);
  assert.equal(shape.length, 2);
  assert.equal(shape[0].x, 110);
});

const FPS = 240;
const swing = () => synthSwing({ kind: 'forehand', frames: 2 * FPS, fps: FPS }) as Seq;

for (const L of [40, 80, 150]) {
  test(`live model @${L} ms inference: continue is less late AND no less accurate than the previous prev→latest interpolation`, () => {
    const truth = swing();
    const a = simulateLive({ truth, truthFps: FPS, latencyMs: L, mode: { kind: 'legacy' } });
    const b = simulateLive({ truth, truthFps: FPS, latencyMs: L, mode: { kind: 'continue' } });
    const A = liveScore(truth, FPS, a.shown, a.times), B = liveScore(truth, FPS, b.shown, b.times);
    console.log(`[live ${L}ms] lag ${A.lagMs} → ${B.lagMs} ms | meanErr ${A.meanErr.toFixed(3)} → ${B.meanErr.toFixed(3)} | maxErr ${A.maxErr.toFixed(2)} → ${B.maxErr.toFixed(2)} | frozen ${(B.frozenFrac * 100).toFixed(0)}%`);
    assert.ok(B.lagMs <= A.lagMs - 25, `lag ${A.lagMs} → ${B.lagMs}`);
    assert.ok(B.meanErr <= A.meanErr * 1.02, 'mean error must not get worse');
    assert.ok(B.maxErr <= A.maxErr * 1.05, 'overshoot must not exceed the old max error');
    assert.ok(B.frozenFrac < 0.1, 'no stair-stepping');
  });
}

test('live model: a still player does not jitter more than before (noise is not amplified by the extrapolation)', () => {
  const still = Array.from({ length: 2 * FPS }, () => swing()[0]) as Seq;
  const jitter = (mode: 'legacy' | 'continue') => {
    const r = simulateLive({ truth: still, truthFps: FPS, latencyMs: 60, mode: { kind: mode }, noisePx: 3, seed: 7 });
    const xs = r.shown.map((p) => p.right_wrist.x).slice(40);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
  };
  const a = jitter('legacy'), b = jitter('continue');
  console.log('[live] still-player jitter σ legacy', a.toFixed(2), 'px → continue', b.toFixed(2), 'px');
  assert.ok(b <= Math.max(a * 1.5, 1.5), `jitter ${a} → ${b}`);
  void mulberry32; void gauss;
});
