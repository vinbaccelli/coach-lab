import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_FAILED_TEXT, analysisProgress, analysisSampleTimes, checkAnalyzedTrack, drawingsExportStatus, includesLabel, mapPoint, overlayTransform, parsePassProgress, skeletonExportStatus,
  trackedFraction, untrackedIntervals,
} from '@/lib/exportOverlay';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('the on-screen video box maps onto the whole output frame', () => {
  // 1920x1080 video letterboxed at (40, 0) size 800x450 in a 880x450 canvas.
  const t = overlayTransform({ dx: 40, dy: 0, dw: 800, dh: 450 }, 1920, 1080)!;
  const tl = mapPoint(t, { x: 40, y: 0 });
  const br = mapPoint(t, { x: 840, y: 450 });
  close(tl.x, 0); close(tl.y, 0);
  close(br.x, 1920); close(br.y, 1080);
  const mid = mapPoint(t, { x: 440, y: 225 });
  close(mid.x, 960); close(mid.y, 540);
});

test('the same drawing keeps its place and proportion at 720p, 1080p and Original', () => {
  const box = { dx: 12, dy: 30, dw: 640, dh: 360 };
  const line = [{ x: 172, y: 120 }, { x: 492, y: 300 }]; // a line in logical px
  for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    const t = overlayTransform(box, w, h)!;
    const [a, b] = line.map((p) => mapPoint(t, p));
    // Relative position inside the frame is identical at every size.
    close(a.x / w, (172 - 12) / 640); close(a.y / h, (120 - 30) / 360);
    close(b.x / w, (492 - 12) / 640); close(b.y / h, (300 - 30) / 360);
    // Uniform scale (aspect kept): a line's width scales with the frame.
    close(t.sx, t.sy, 1e-9);
  }
});

test('a portrait clip maps the same way', () => {
  const t = overlayTransform({ dx: 300, dy: 0, dw: 253.125, dh: 450 }, 1080, 1920)!;
  const p = mapPoint(t, { x: 300 + 253.125 / 2, y: 450 / 4 });
  close(p.x, 540, 1e-6); close(p.y, 480, 1e-6);
  close(t.sx, t.sy, 1e-9);
});

test('a degenerate box or output gives no transform', () => {
  assert.equal(overlayTransform({ dx: 0, dy: 0, dw: 0, dh: 450 }, 1920, 1080), null);
  assert.equal(overlayTransform({ dx: 0, dy: 0, dw: 800, dh: 450 }, 0, 1080), null);
});

test('trackedFraction: whole, none, half, and a gap', () => {
  assert.equal(trackedFraction(0, 10, () => true), 1);
  assert.equal(trackedFraction(0, 10, () => false), 0);
  assert.equal(trackedFraction(0, 10, (t) => t < 5), 0.5);
  close(trackedFraction(2, 12, (t) => t < 4 || t >= 9), 0.5, 0.011);
  assert.equal(trackedFraction(5, 5, () => true), 0);
  assert.equal(trackedFraction(5, 4, () => true), 0);
});

test('trackedFraction caps the number of samples on a long range', () => {
  let calls = 0;
  trackedFraction(0, 7200, () => { calls++; return true; }, 600);
  assert.equal(calls, 600);
  calls = 0;
  trackedFraction(0, 2, () => { calls++; return true; });
  assert.equal(calls, 20);
});

test('skeleton switch is never dead: untracked or partly tracked ranges are analyzed first', () => {
  assert.deepEqual(skeletonExportStatus(false, 1), { state: 'ready', text: 'Skeleton ready.' });
  assert.deepEqual(skeletonExportStatus(false, 0), {
    state: 'analyze', text: 'Not analyzed yet. The skeleton will be analyzed first when you export, which adds time.',
  });
  assert.equal(skeletonExportStatus(false, 0.42).text, 'Skeleton covers 42% of this range. The rest will be analyzed first when you export, which adds time.');
  assert.equal(skeletonExportStatus(false, 0.42).state, 'analyze');
  // Partial never reads 0% or 100%.
  assert.match(skeletonExportStatus(false, 0.001).text, /covers 1% /);
  assert.match(skeletonExportStatus(false, 0.996).text, /covers 99% /);
});

test('skeleton switch waits only for an AI Track already running', () => {
  assert.deepEqual(skeletonExportStatus(true, 1), { state: 'busy', text: 'AI Track is running. Wait for it to finish, then export.' });
  assert.equal(skeletonExportStatus(true, 0).state, 'busy');
});

test('untrackedIntervals: nothing tracked → the whole range (inset)', () => {
  const r = untrackedIntervals(2, 6, () => false);
  assert.equal(r.length, 1);
  close(r[0].start, 2.05, 1e-9); close(r[0].end, 5.95, 1e-9);
});

test('untrackedIntervals: fully tracked → nothing to analyze', () => {
  assert.deepEqual(untrackedIntervals(0, 9, () => true), []);
});

test('untrackedIntervals: gaps between tracks stay clear of the neighbouring tracks', () => {
  // A track [0, 3] and a track [6, 9]; the look-up reaches 0.1 s past each.
  const tracked = (t: number) => (t >= -0.1 && t <= 3.1) || (t >= 5.9 && t <= 9.1);
  const r = untrackedIntervals(0, 9, tracked);
  assert.equal(r.length, 1);
  // finishBakeCapture drops tracks with end >= start - 0.05 (or start <= end + 0.05):
  assert.ok(3 < r[0].start - 0.05, `left track kept (gap starts ${r[0].start})`);
  assert.ok(6 > r[0].end + 0.05, `right track kept (gap ends ${r[0].end})`);
  // ...and the 0.1 s look-up reach still covers the inset on both sides.
  assert.ok(r[0].start - 0.1 <= 3.1 + 1e-9);
  assert.ok(r[0].end + 0.1 >= 5.9 - 1e-9);
});

test('untrackedIntervals: tiny gaps are skipped, bad ranges give nothing', () => {
  const tracked = (t: number) => !(t > 4.0 && t < 4.15);
  assert.deepEqual(untrackedIntervals(0, 9, tracked), []);
  assert.deepEqual(untrackedIntervals(5, 5, () => false), []);
  assert.deepEqual(untrackedIntervals(5, 4, () => false), []);
});

test('parsePassProgress reads the AI Track pass status line', () => {
  assert.equal(parsePassProgress('AI-tracking… 42% (0.5× · real feet)'), 0.42);
  assert.equal(parsePassProgress('AI-tracking… 100% (0.5×)'), 1);
  assert.equal(parsePassProgress('Loading precision tracking model…'), null);
  assert.equal(parsePassProgress(null), null);
});

test('analysisProgress spans several intervals by their length', () => {
  const iv = [{ start: 0, end: 2 }, { start: 5, end: 11 }];
  assert.equal(analysisProgress(iv, 0, 0), 0);
  assert.equal(analysisProgress(iv, 0, 1), 0.25);
  assert.equal(analysisProgress(iv, 1, 0.5), 0.625);
  assert.equal(analysisProgress(iv, 2, 0), 1);
  assert.equal(analysisProgress([], 0, 0.5), 0);
});

test('drawings status lines', () => {
  assert.deepEqual(drawingsExportStatus(true, 4), { state: 'snapshot', text: 'Snapshot drawings aren’t exported. Use Snapshot report.' });
  assert.deepEqual(drawingsExportStatus(false, 0), { state: 'none', text: 'No drawings on the video' });
  assert.equal(drawingsExportStatus(false, 1).text, '1 drawing on the video.');
  assert.equal(drawingsExportStatus(false, 3).text, '3 drawings on the video.');
});

test('includes label', () => {
  assert.equal(includesLabel(true, true), 'Includes: video + skeleton + drawings');
  assert.equal(includesLabel(false, true), 'Includes: video + drawings');
  assert.equal(includesLabel(true, false), 'Includes: video + skeleton');
  assert.equal(includesLabel(false, false), 'Includes: video');
});

// A 17-joint pose: a standing figure about 100 px tall, shifted by (dx, dy), the right wrist raised by `wrist`.
const pose = (dx = 0, dy = 0, wrist = 0) => Array.from({ length: 17 }, (_, j) => ({
  x: 100 + dx + (j % 2 ? 20 : -20), y: 50 + dy + j * 6 - (j === 10 ? wrist : 0), score: 0.9, name: String(j),
}));

test('checkAnalyzedTrack: a moving player passes', () => {
  const poses = Array.from({ length: 20 }, (_, i) => pose(i * 2, 0, i));
  const r = checkAnalyzedTrack(58, 1.9, poses);
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.ok(r.motion > 0.1, `motion ${r.motion}`);
  close(r.posesPerSec, 58 / 1.9, 1e-9);
});

test('checkAnalyzedTrack: the same pose on every frame is a frozen skeleton', () => {
  const p = pose(5, 5);
  const r = checkAnalyzedTrack(58, 1.9, Array.from({ length: 20 }, () => p.map((k) => ({ ...k }))));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'static');
  assert.equal(r.motion, 0);
});

test('checkAnalyzedTrack: a still player with normal detection jitter still passes', () => {
  // ±0.5 px of jitter on a ~117 px body (the smallest real motion the pass reports).
  const poses = Array.from({ length: 20 }, (_, i) => pose(i % 2 ? 0.5 : -0.5, i % 3 ? 0.4 : 0));
  assert.equal(checkAnalyzedTrack(58, 1.9, poses).ok, true);
});

test('checkAnalyzedTrack: too few poses for the analyzed time is too sparse', () => {
  const moving = Array.from({ length: 20 }, (_, i) => pose(i * 3));
  assert.equal(checkAnalyzedTrack(1, 2, moving).reason, 'sparse');
  assert.equal(checkAnalyzedTrack(5, 9, moving).reason, 'sparse'); // 0.6 poses/s from a 30 fps pass
  assert.equal(checkAnalyzedTrack(30, 2, [pose()]).reason, 'sparse'); // one pose across the range
  assert.equal(checkAnalyzedTrack(30, 2, [null, null]).reason, 'sparse');
  assert.equal(checkAnalyzedTrack(0, 0, []).reason, 'sparse');
  assert.equal(checkAnalyzedTrack(27, 9, moving).ok, true); // 3 poses/s is enough
});

test('checkAnalyzedTrack: low-score joints are ignored', () => {
  // Only the hidden joints "move"; the visible body is frozen.
  const poses = Array.from({ length: 10 }, (_, i) => pose().map((k, j) => (j >= 13 ? { ...k, x: k.x + i * 10, score: 0.1 } : k)));
  assert.equal(checkAnalyzedTrack(58, 1.9, poses).reason, 'static');
});

test('the analysis failure message, and the switch after a failed analysis', () => {
  assert.equal(ANALYSIS_FAILED_TEXT, 'Skeleton could not be analyzed on this video');
  // The failed track covers the range, but it is not offered as "ready".
  assert.deepEqual(skeletonExportStatus(false, 1, true), { state: 'failed', text: 'Skeleton could not be analyzed on this video.' });
  assert.equal(skeletonExportStatus(true, 1, true).state, 'failed');
  assert.equal(skeletonExportStatus(false, 1, false).state, 'ready');
});

test('analysisSampleTimes: spread over the analyzed intervals, capped', () => {
  const one = analysisSampleTimes([{ start: 0.05, end: 1.95 }]);
  assert.equal(one.length, 19);
  assert.ok(one.every((t) => t > 0.05 && t < 1.95));
  const two = analysisSampleTimes([{ start: 0, end: 1 }, { start: 5, end: 8 }]);
  assert.ok(two.filter((t) => t < 1).length >= 2 && two.filter((t) => t >= 5).length >= 2);
  assert.ok(two.every((t) => (t > 0 && t < 1) || (t > 5 && t < 8)));
  assert.equal(analysisSampleTimes([{ start: 0, end: 7200 }]).length, 300);
  assert.deepEqual(analysisSampleTimes([]), []);
});
