import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExportPose, EXPORT_POSE_DUTY, EXPORT_POSE_GIVE_UP_MS, EXPORT_POSE_MAX_AGE_SEC, EXPORT_POSE_MIN_INTERVAL_MS,
  extrapolatePose, medianOf, nextDetectDelayMs, scratchSize, type ExportPoseDeps, type Kp,
} from '../lib/exportPose';

const pose = (x: number, y = 100): Kp[] => [
  { x, y, score: 0.9, name: 'left_wrist' },
  { x: x + 50, y: y + 10, score: 0.9, name: 'right_wrist' },
];

/** A fake clock + detector whose result arrives after `detectMs` of fake time. */
function rig(opts: { detectMs?: number; result?: (frameT: number, n: number) => Kp[] | null; grab?: boolean } = {}) {
  const detectMs = opts.detectMs ?? 40;
  let nowMs = 1000;
  const log: string[] = [];
  let fails = 0;
  let detectCalls = 0;
  const pending: Array<() => void> = [];
  const deps: ExportPoseDeps = {
    now: () => nowMs,
    grab: () => (opts.grab === false ? null : { src: 'scratch', vw: 720, vh: 1280 }),
    detect: () => new Promise((resolve) => {
      detectCalls++;
      const n = detectCalls;
      const frameT = lastFrameT;
      pending.push(() => resolve(opts.result ? opts.result(frameT, n) : pose(frameT * 100)));
    }),
    log: (l) => log.push(l),
    onFail: () => { fails++; },
  };
  let lastFrameT = 0;
  const ep = new ExportPose(deps, 0.5);
  return {
    ep, log, deps,
    get fails() { return fails; },
    get detectCalls() { return detectCalls; },
    frame(t: number) { lastFrameT = t; ep.onFrame(t, 'video'); },
    advance(ms: number) { nowMs += ms; },
    /** Let the in-flight detection finish after `detectMs`. */
    async finishDetect() { nowMs += detectMs; pending.splice(0).forEach((f) => f()); await Promise.resolve(); await Promise.resolve(); },
  };
}

test('scratch size: long side ≤ 512, aspect kept, never enlarged', () => {
  assert.deepEqual(scratchSize(1920, 1080), { w: 512, h: 288 });
  assert.deepEqual(scratchSize(720, 1280), { w: 288, h: 512 });
  assert.deepEqual(scratchSize(400, 300), { w: 400, h: 300 });
  assert.deepEqual(scratchSize(0, 10), { w: 0, h: 0 });
});

test('duty cycle: the next detection waits DUTY × the median, never less than the minimum', () => {
  assert.equal(nextDetectDelayMs(40), 40 * EXPORT_POSE_DUTY);
  assert.equal(nextDetectDelayMs(2), EXPORT_POSE_MIN_INTERVAL_MS);
  assert.equal(medianOf([5, 1, 9]), 5);
  assert.equal(medianOf([1, 3]), 2);
  assert.equal(medianOf([]), 0);
});

test('one detection at a time; frames in between never wait and reuse the last pose', async () => {
  const r = rig({ detectMs: 50 });
  r.frame(0.0);                       // starts a detection
  assert.equal(r.detectCalls, 1);
  r.advance(10); r.frame(0.01);       // still in flight
  r.advance(10); r.frame(0.02);
  assert.equal(r.detectCalls, 1);
  assert.equal(r.ep.poseAt(0.02), null, 'no pose until the first detection lands');
  await r.finishDetect();
  assert.ok(r.ep.poseAt(0.05), 'then the latest pose is drawn');
  r.frame(0.06);                      // inside the duty window (3 × 50 ms): no new detection
  assert.equal(r.detectCalls, 1);
  r.advance(300); r.frame(0.3);       // past it
  assert.equal(r.detectCalls, 2);
});

test('a pose is moved on by its own velocity for at most a few ms, and dropped when too old', async () => {
  const r = rig({ detectMs: 20, result: (t) => pose(t * 1000) });
  r.frame(0.0); await r.finishDetect();                 // pose at t=0: x=0
  r.advance(500); r.frame(0.2); await r.finishDetect(); // pose at t=0.2: x=200
  const at = r.ep.poseAt(0.2)!;
  assert.ok(Math.abs(at[0].x - 200) < 2, `x=${at[0].x}`); // the causal smoother may move it a little
  const later = r.ep.poseAt(0.2 + 0.05)!;               // 50 ms on: 1000 px/s × 0.05 s = +50
  assert.ok(later[0].x > at[0].x && later[0].x <= at[0].x + 55, `x=${later[0].x}`);
  const capped = r.ep.poseAt(0.2 + 0.4)!;               // capped at the extrapolation limit
  assert.ok(capped[0].x <= at[0].x + 1000 * 0.08 + 5, `x=${capped[0].x}`);
  assert.equal(r.ep.poseAt(0.2 + EXPORT_POSE_MAX_AGE_SEC + 0.01), null);
});

test('extrapolatePose matches by name and ignores weak points', () => {
  const a = { t: 0, kps: [{ x: 0, y: 0, score: 0.9, name: 'a' }, { x: 0, y: 0, score: 0.05, name: 'b' }] };
  const b = { t: 0.1, kps: [{ x: 10, y: 0, score: 0.9, name: 'a' }, { x: 10, y: 0, score: 0.9, name: 'b' }, { x: 5, y: 5, score: 0.9, name: 'c' }] };
  const out = extrapolatePose(a, b, 0.14);
  assert.ok(out[0].x > 10);
  assert.equal(out[1].x, 10, 'weak previous point: not moved');
  assert.equal(out[2].x, 5, 'new point: not moved');
  assert.equal(extrapolatePose(null, b, 0.14), b.kps);
});

test('no pose within 4 s fails the export once, clearly logged', async () => {
  const r = rig({ detectMs: 30, result: () => null });
  for (let i = 0; i < 20; i++) { r.frame(i * 0.05); await r.finishDetect(); r.advance(250); }
  assert.equal(r.fails, 1);
  assert.ok(r.ep.hasFailed);
  assert.match(r.log.join('\n'), /export pose: FAILED/);
  r.frame(10);                                   // after a failure it does nothing more
  assert.equal(r.fails, 1);
});

test('a detector that never answers also fails at 4 s', () => {
  const r = rig();
  r.frame(0);
  r.advance(EXPORT_POSE_GIVE_UP_MS - 1); r.frame(1);
  assert.equal(r.fails, 0);
  r.advance(2); r.frame(2);
  assert.equal(r.fails, 1);
});

test('one pose in time is enough: no failure', async () => {
  const r = rig({ detectMs: 30 });
  r.frame(0); await r.finishDetect();
  r.advance(EXPORT_POSE_GIVE_UP_MS + 500); r.frame(5);
  assert.equal(r.fails, 0);
});

test('the log line has detections, median ms, skipped frames and speed; a frame with nothing to copy is skipped', async () => {
  const r = rig({ detectMs: 45 });
  r.frame(0); await r.finishDetect();
  r.advance(10); r.frame(0.05);
  r.ep.finish();
  const line = r.log[r.log.length - 1];
  assert.match(line, /^export pose: 1 detections \(1 with a pose\), median 45 ms, 1 of 2 frames reused the last pose, speed 0\.5×/);
  const none = rig({ grab: false });
  none.frame(0);
  assert.equal(none.detectCalls, 0);
});

test('a throwing detector is counted, not thrown', async () => {
  let nowMs = 0;
  const log: string[] = [];
  const ep = new ExportPose({
    now: () => nowMs, grab: () => ({ src: 1, vw: 1, vh: 1 }),
    detect: () => Promise.reject(new Error('gpu')), log: (l) => log.push(l), onFail: () => {},
  });
  ep.onFrame(0, 'v');
  await Promise.resolve(); await Promise.resolve();
  nowMs = 3000; ep.onFrame(3, 'v');
  assert.match(ep.statsText(), /1 errors/);
});
