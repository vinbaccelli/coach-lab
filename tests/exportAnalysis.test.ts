import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeForExport, type ExportAnalysisDeps } from '@/lib/exportOverlay';
import { watchPassFrames, type WatchedVideo } from '@/lib/analysisFrameLog';

// Records every step the export's analysis takes, in order.
function deps(skeleton: boolean, track: (a: number, b: number) => Promise<number>) {
  const calls: string[] = [];
  let on = skeleton;
  const d: ExportAnalysisDeps = {
    skeletonOn: () => on,
    turnSkeletonOn: () => { calls.push('skeleton on'); on = true; },
    skeletonCommitted: async () => { calls.push('committed'); },
    track: async (a, b) => { calls.push(`track ${a}-${b}`); return track(a, b); },
    watch: () => { calls.push('watch'); return () => calls.push('stop'); },
  };
  return { d, calls, on: () => on };
}

test('export analysis turns Skeleton on like the toolbar, runs the AI Track handler, and leaves Skeleton on', async () => {
  const x = deps(false, async () => 91);
  assert.equal(await analyzeForExport(x.d, 1, 4.1), 91);
  assert.deepEqual(x.calls, ['skeleton on', 'committed', 'watch', 'track 1-4.1', 'stop']);
  assert.equal(x.on(), true);
});

test('export analysis with Skeleton already on does not touch it', async () => {
  const x = deps(true, async () => 12);
  assert.equal(await analyzeForExport(x.d, 0, 2), 12);
  assert.deepEqual(x.calls, ['watch', 'track 0-2', 'stop']);
});

test('Cancel: the handler resolves 0 and the frame log is stopped', async () => {
  const x = deps(false, async () => 0);
  assert.equal(await analyzeForExport(x.d, 0, 2), 0);
  assert.equal(x.calls.at(-1), 'stop');
});

test('error: it propagates and the frame log is still stopped', async () => {
  const x = deps(false, async () => { throw new Error('model failed'); });
  await assert.rejects(analyzeForExport(x.d, 0, 2), /model failed/);
  assert.equal(x.calls.at(-1), 'stop');
  assert.equal(x.on(), true); // left on, as the toolbar leaves it
});

// A video that fires 'seeked' on demand and presents frames when told to.
function fakeVideo(withRvfc: boolean) {
  const listeners = new Set<() => void>();
  const frames: Array<(now: number, meta: { mediaTime?: number }) => void> = [];
  const v = {
    currentTime: 0,
    addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
    ...(withRvfc ? { requestVideoFrameCallback: (cb: (now: number, meta: { mediaTime?: number }) => void) => frames.push(cb) } : {}),
  };
  const seek = (t: number) => { v.currentTime = t; listeners.forEach((fn) => fn()); };
  const present = (mediaTime: number) => { const cbs = frames.splice(0); cbs.forEach((cb) => cb(0, { mediaTime })); };
  return { v: v as unknown as WatchedVideo, seek, present, listeners };
}

test('frame log: every 10th seek, with currentTime, the presented mediaTime and wall time', () => {
  const f = fakeVideo(true);
  const lines: string[] = [];
  let clock = 1000;
  const stop = watchPassFrames(f.v, (l) => lines.push(l), 10, () => clock);
  for (let k = 1; k <= 20; k++) { clock += 30; f.seek(k / 30); if (k % 10 === 0) f.present(0.1); }
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^seek #10 t=0\.333 rvfc mediaTime=0\.100 wall=300 ms \(\+300\)$/);
  assert.match(lines[1], /^seek #20 t=0\.667 rvfc mediaTime=0\.100 wall=600 ms \(\+300\)$/);
  stop();
  assert.match(lines[2], /^analysis end: 20 seeks in 600 ms$/);
  assert.equal(f.listeners.size, 0);
});

test('frame log without requestVideoFrameCallback, and nothing after stop()', () => {
  const f = fakeVideo(false);
  const lines: string[] = [];
  const stop = watchPassFrames(f.v, (l) => lines.push(l), 10, () => 0);
  for (let k = 1; k <= 10; k++) f.seek(k);
  assert.match(lines[0], /rvfc=n\/a/);
  stop(); stop();
  for (let k = 1; k <= 10; k++) f.seek(k);
  assert.equal(lines.length, 2); // one sample line + one end line, never repeated
});

test('a frame presented after stop() is not logged', () => {
  const f = fakeVideo(true);
  const lines: string[] = [];
  const stop = watchPassFrames(f.v, (l) => lines.push(l), 10, () => 0);
  for (let k = 1; k <= 10; k++) f.seek(k);
  stop();
  f.present(1);
  assert.deepEqual(lines, ['analysis end: 10 seeks in 0 ms']);
});
