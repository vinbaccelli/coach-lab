import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawingsExportStatus, includesLabel, mapPoint, overlayTransform, skeletonExportStatus, trackedFraction,
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

test('skeleton status lines', () => {
  assert.deepEqual(skeletonExportStatus(false, 1), { state: 'off', text: 'Turn on Skeleton to include it.' });
  assert.deepEqual(skeletonExportStatus(true, 1), { state: 'ready', text: 'Ready.' });
  assert.deepEqual(skeletonExportStatus(true, 0), { state: 'none', text: 'No AI Track on this range, so no skeleton in the video.' });
  assert.equal(skeletonExportStatus(true, 0.42).text, 'Skeleton covers 42% of this range.');
  // Partial never reads 0% or 100%.
  assert.equal(skeletonExportStatus(true, 0.001).text, 'Skeleton covers 1% of this range.');
  assert.equal(skeletonExportStatus(true, 0.996).text, 'Skeleton covers 99% of this range.');
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
