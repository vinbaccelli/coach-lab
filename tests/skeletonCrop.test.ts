import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldCrop, cropRect, mapFromCrop, touchesCropEdge, acceptCropPose, trackBox, CROP_BELOW, CROP_PAD, type Box,
} from '../lib/skeletonCrop';

const VW = 1920, VH = 1080;
const box = (cx: number, cy: number, h: number, w = h * 0.5): Box => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
/** COCO-17 pose filling `b`: body joints (5–16) spread over the box, all confident unless overridden. */
function poseIn(b: Box, score = 0.9): Array<{ x: number; y: number; score: number }> {
  const out = Array.from({ length: 17 }, () => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, score: 0 }));
  for (let i = 5; i <= 16; i++) {
    const f = (i - 5) / 11;
    out[i] = { x: b.x0 + (b.x1 - b.x0) * (i % 2 ? 0.8 : 0.2), y: b.y0 + (b.y1 - b.y0) * f, score };
  }
  out[0] = { x: (b.x0 + b.x1) / 2, y: b.y0, score };
  return out;
}

test('crop only for a known SMALL player; large players keep the full-frame path', () => {
  assert.equal(shouldCrop(null, VH), false);
  assert.equal(shouldCrop(box(900, 700, 281), VH), true);
  assert.equal(shouldCrop(box(900, 600, 600), VH), false, '600 px of 1080 = large');
  assert.equal(shouldCrop(box(900, 600, CROP_BELOW * VH - 1), VH), true);
  assert.equal(shouldCrop(box(900, 600, CROP_BELOW * VH), VH), false);
});

test('crop contains the whole box with margin for the racket arm, stays inside the frame', () => {
  const b = box(960, 700, 300);
  const r = cropRect(b, VW, VH);
  assert.ok(r.x <= b.x0 && r.y <= b.y0 && r.x + r.w >= b.x1 && r.y + r.h >= b.y1);
  assert.ok(r.w >= 300 * (1 + CROP_PAD) - 1e-9);
  const edge = cropRect(box(10, 1070, 300), VW, VH);
  assert.ok(edge.x >= 0 && edge.y >= 0 && edge.x + edge.w <= VW && edge.y + edge.h <= VH);
  const tiny = cropRect(box(500, 500, 20), VW, VH);
  assert.ok(tiny.w >= 192, 'minimum crop size');
});

test('mapFromCrop restores video coordinates', () => {
  const m = mapFromCrop([{ x: 10, y: 20, score: 1 }], { x: 100, y: 200, w: 50, h: 50 });
  assert.deepEqual(m, [{ x: 110, y: 220, score: 1 }]);
});

test('same player in the crop is accepted', () => {
  const prev = box(900, 700, 300);
  const r = cropRect(prev, VW, VH);
  assert.equal(acceptCropPose(prev, poseIn(box(905, 702, 305)), r, VW, VH), true);
});

test('re-acquire (reject): too few confident joints, wrong size, jumped away, cut by the crop, null', () => {
  const prev = box(900, 700, 300);
  const r = cropRect(prev, VW, VH);
  assert.equal(acceptCropPose(prev, null, r, VW, VH), false);
  const weak = poseIn(box(900, 700, 300)); for (let i = 5; i <= 12; i++) weak[i].score = 0.1;
  assert.equal(acceptCropPose(prev, weak, r, VW, VH), false, 'only 4 confident joints');
  assert.equal(acceptCropPose(prev, poseIn(box(900, 700, 90)), r, VW, VH), false, 'size ratio 0.3');
  assert.equal(acceptCropPose(prev, poseIn(box(900, 700, 700)), r, VW, VH), false, 'size ratio 2.3');
  const far = box(900 + 420, 700, 300);
  assert.equal(acceptCropPose(prev, poseIn(far), r, VW, VH), false, 'centre moved > 1 body height');
  // joints piled on the crop's left edge (frame edge not involved) ⇒ player probably cut off
  const cut = poseIn(box(900, 700, 300));
  for (const i of [5, 7, 9]) cut[i] = { x: r.x + 2, y: cut[i].y, score: 0.9 };
  assert.equal(touchesCropEdge(cut, r, VW, VH), true);
  assert.equal(acceptCropPose(prev, cut, r, VW, VH), false);
});

test('a crop edge that IS the frame edge does not count as cut', () => {
  const prev = box(60, 700, 300); // near the left frame edge ⇒ crop clamped to x=0
  const r = cropRect(prev, VW, VH);
  assert.equal(r.x, 0);
  const p = poseIn(box(60, 700, 300));
  for (const i of [5, 7, 9]) p[i] = { x: 1, y: p[i].y, score: 0.9 };
  assert.equal(touchesCropEdge(p, r, VW, VH), false);
});

test('trackBox needs confident joints', () => {
  assert.equal(trackBox(null), null);
  assert.equal(trackBox(poseIn(box(900, 700, 300), 0.1)), null);
  assert.ok(trackBox(poseIn(box(900, 700, 300))));
});
