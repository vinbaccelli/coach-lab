import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockMoved, hashBytes, hashKps, sampleLine, shouldLogSample, summaryLine, TraceStats, verdictText } from '../lib/traceDiag';

const kp = (dx: number) => [
  { x: 100 + dx, y: 200, score: 0.9, name: 'left_wrist' },
  { x: 300, y: 210, score: 0.9, name: 'right_wrist' },
  { x: 150, y: 100, score: 0.9, name: 'left_shoulder' },
];

test('hashBytes: same bytes, same hash; a different picture, a different hash; small noise is ignored', () => {
  const a = Uint8Array.from({ length: 1024 }, (_, i) => (i * 7) & 255);
  const same = Uint8Array.from(a);
  const noisy = Uint8Array.from(a, (v) => (v & ~7) | 3); // only the low 3 bits differ
  const other = Uint8Array.from(a, (v, i) => (i === 500 ? (v + 64) & 255 : v));
  assert.equal(hashBytes(a), hashBytes(same));
  assert.equal(hashBytes(a), hashBytes(noisy));
  assert.notEqual(hashBytes(a), hashBytes(other));
  assert.match(hashBytes(a), /^[0-9a-f]{8}$/);
});

test('hashKps: moves with the player, ignores sub-pixel jitter, "none" without a pose', () => {
  assert.equal(hashKps(kp(0)), hashKps(kp(0.2)));
  assert.notEqual(hashKps(kp(0)), hashKps(kp(5)));
  assert.equal(hashKps(null), 'none');
  assert.equal(hashKps([]), 'none');
});

test('sample log schedule: the first 5, then every 15th', () => {
  const logged = Array.from({ length: 50 }, (_, i) => i).filter(shouldLogSample);
  assert.deepEqual(logged, [0, 1, 2, 3, 4, 15, 30, 45]);
});

test('TraceStats counts distinct times, pixels, video reads and keypoints', () => {
  const s = new TraceStats();
  s.add(1.0, 'aaaa', 'aaaa', 'k1');
  s.add(1.033, 'aaaa', 'aaaa', 'k2');
  s.add(1.033, 'bbbb', 'aaaa', 'k2');
  s.add(2.0, 'cccc', 'dddd', 'k3');
  assert.deepEqual(s.summary(), { samples: 4, distinctT: 3, distinctPix: 3, distinctVid: 2, distinctKp: 3, firstT: 1, lastT: 2 });
  assert.equal(new TraceStats().summary().firstT, null);
});

test('log lines carry every field a single run needs', () => {
  const l = sampleLine({ index: 3, mediaT: 1.2346, currentTime: 1.25, presented: 77, pix: 'p', vid: 'v', kp: 'k', observedRate: 0.256, rateSet: 0.25 });
  assert.match(l, /^trace #3 t=1\.235 video\.currentTime=1\.250 presentedFrames=77 pixels=p video=v keypoints=k rate=0\.26× \(set 0\.25×\)$/);
  const sm = summaryLine({ samples: 10, distinctT: 10, distinctPix: 1, distinctVid: 1, distinctKp: 9, firstT: 0.05, lastT: 8.5 }, { samples: 10, start: 0.05, end: 8.5 }, 0.25);
  assert.match(sm, /10 samples, times 0\.050–8\.500 \(10 distinct\), pixel hashes 1 \(video 1\), keypoint hashes 9, observed rate 0\.25×, stored 10 samples 0\.050–8\.500/);
  assert.match(summaryLine({ samples: 0, distinctT: 0, distinctPix: 0, distinctVid: 0, distinctKp: 0, firstT: null, lastT: null }, null, null), /times n\/a–n\/a .*stored none/);
});

test('render clock: moved only when it covers half the range', () => {
  assert.equal(clockMoved(0, 8.4, 8.5), true);
  assert.equal(clockMoved(0, 0, 8.5), false);
  assert.equal(clockMoved(2, 2.3, 8.5), false);
  assert.equal(clockMoved(0, 0.6, 0.8), true);
  assert.equal(clockMoved(Infinity, -Infinity, 5), false);
});

test('the one-line verdict', () => {
  assert.equal(verdictText({ pix: 1, kp: 40, stored: 120, clockMoved: true }), 'trace: pixel hashes 1, keypoint hashes 40, stored samples 120, render clock moved yes');
  assert.equal(verdictText({ pix: null, kp: null, stored: null, clockMoved: false }), 'trace: render clock moved no');
  assert.equal(verdictText({ pix: 5, kp: 5, stored: null, clockMoved: null }), 'trace: pixel hashes 5, keypoint hashes 5, stored samples n/a, render clock moved n/a');
});

test("the 'trace' log slot has its own quota: the others cannot push it out and it cannot push them out", async () => {
  const { firstFrameLog, firstFrameLogLines } = await import('../lib/firstFrame');
  (globalThis as { performance?: Performance }).performance ??= { now: () => 0 } as Performance;
  const before = firstFrameLogLines().length;
  for (let i = 0; i < 30; i++) firstFrameLog('trace', `trace line ${i}`);
  for (let i = 0; i < 300; i++) firstFrameLog('export', `other line ${i}`);
  for (let i = 0; i < 70; i++) firstFrameLog('analysis', `analysis line ${i}`);
  const lines = firstFrameLogLines();
  assert.equal(lines.filter((l) => l.slot === 'trace').length, 30, `trace lines kept (log had ${before} before)`);
  assert.ok(lines.filter((l) => l.slot === 'export').length <= 80);
  assert.equal(lines.filter((l) => l.slot === 'analysis').length, 60);
  for (let i = 0; i < 150; i++) firstFrameLog('trace', `more ${i}`);
  assert.equal(lines.filter((l) => l.slot === 'trace').length, 100);
  assert.equal(lines.filter((l) => l.slot === 'analysis').length, 60);
});
