import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containRect, cropFromBox, decodeSimcc, boxFromKeypoints, iou, bestPerson, cropToTensor, IN_W, IN_H, SIMCC_X, SIMCC_Y, COCO17, rgbaCropToTensor } from '../lib/rtmpose/core';
import { summarize, compareToReference, type LabFrame } from '../lib/rtmpose/labMetrics';

test('cropFromBox keeps the 3:4 model aspect and pads 1.25×', () => {
  const c = cropFromBox({ x: 100, y: 100, w: 100, h: 400 });
  assert.equal(c.cx, 150); assert.equal(c.cy, 300);
  assert.ok(Math.abs(c.sw / c.sh - IN_W / IN_H) < 1e-9);
  assert.equal(c.sh, 400 * 1.25);
  const wide = cropFromBox({ x: 0, y: 0, w: 400, h: 100 });
  assert.ok(Math.abs(wide.sw / wide.sh - IN_W / IN_H) < 1e-9);
  assert.equal(wide.sw, 400 * 1.25);
});

test('decodeSimcc maps argmax bins back to frame pixels (split ratio 2)', () => {
  const sx = new Float32Array(17 * SIMCC_X), sy = new Float32Array(17 * SIMCC_Y);
  // joint 0 at crop pixel (96, 128) = bin (192, 256); joint 5 at crop pixel (48, 64) = bin (96, 128)
  sx[0 * SIMCC_X + 192] = 0.9; sy[0 * SIMCC_Y + 256] = 0.8;
  sx[5 * SIMCC_X + 96] = 0.7; sy[5 * SIMCC_Y + 128] = 0.95;
  const crop = { cx: 1000, cy: 500, sw: 384, sh: 512 }; // 2× the model input
  const kps = decodeSimcc(sx, sy, crop);
  assert.equal(kps.length, 17);
  assert.equal(kps[0].name, COCO17[0]);
  assert.ok(Math.abs(kps[0].x - 1000) < 1e-9 && Math.abs(kps[0].y - 500) < 1e-9, 'centre bin → crop centre');
  assert.ok(Math.abs(kps[0].score - 0.8) < 1e-6, 'score = min of the two maxima');
  assert.ok(Math.abs(kps[5].x - (1000 - 192 + 96)) < 1e-9 && Math.abs(kps[5].y - (500 - 256 + 128)) < 1e-9);
});

test('cropToTensor: identity crop reproduces normalised pixels, outside the frame is black', () => {
  const w = IN_W, h = IN_H;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 123.675; rgba[i * 4 + 1] = 116.28; rgba[i * 4 + 2] = 103.53; rgba[i * 4 + 3] = 255; }
  const t = cropToTensor(rgba, w, h, { cx: w / 2, cy: h / 2, sw: w, sh: h });
  assert.ok(Math.abs(t[10 * IN_W + 10]) < 0.01, 'mean colour → ~0 after normalisation');
  const off = cropToTensor(rgba, w, h, { cx: -5000, cy: -5000, sw: w, sh: h });
  assert.ok(off[0] < -1.5, 'black outside the frame');
  const same = rgbaCropToTensor(rgba);
  assert.ok(Math.abs(same[5] - t[5]) < 0.02, 'canvas path and warp path agree');
});

test('boxFromKeypoints needs enough confident joints; iou and bestPerson prefer the followed player', () => {
  const k = COCO17.map((n, i) => ({ name: n, x: 100 + i, y: 50 + i * 10, score: 0.9 }));
  const b = boxFromKeypoints(k)!;
  assert.ok(b.w > 0 && b.h > 100);
  assert.equal(boxFromKeypoints(k.map((p) => ({ ...p, score: 0.1 }))), null);
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 }), 0);
  const dets = [0, 0, 100, 200, 0.95, 300, 0, 400, 200, 0.6]; // two people; second less confident
  const labels = [0, 0];
  assert.equal(bestPerson(dets, labels, 1)!.x, 0, 'most confident without a previous box');
  assert.equal(bestPerson(dets, labels, 1, 0.3, { x: 310, y: 0, w: 90, h: 200 })!.x, 300, 'the one overlapping the followed box');
  assert.equal(bestPerson(dets, [1, 1], 1), null, 'only label 0 (person) counts');
});

function frames(n: number, f: (i: number) => Record<string, [number, number]>, ms = 10): LabFrame[] {
  return Array.from({ length: n }, (_, i) => {
    const p = f(i);
    return { t: i / 15, ms, kps: COCO17.map((name) => ({ name, x: (p[name] ?? [0, 0])[0], y: (p[name] ?? [0, 0])[1], score: 0.9 })) };
  });
}
const standing = (i: number): Record<string, [number, number]> => ({
  left_shoulder: [90, 100], right_shoulder: [110, 100], left_elbow: [85, 130], right_elbow: [115, 130], left_wrist: [85 + i, 160], right_wrist: [115, 160 - i],
  left_hip: [93, 200], right_hip: [107, 200], left_knee: [93, 260], right_knee: [107, 260], left_ankle: [93, 320], right_ankle: [107, 320],
});

test('labMetrics: summary, reference comparison, wrist speed ratio', () => {
  const ref = frames(30, standing);
  const same = compareToReference(ref, ref);
  assert.equal(same.meanErrBh, 0); assert.equal(same.pck10, 1); assert.equal(same.wristSpeedRatio, 1);
  const shifted = frames(30, (i) => Object.fromEntries(Object.entries(standing(i)).map(([k, [x, y]]) => [k, [x + 40, y]])) as Record<string, [number, number]>);
  const c = compareToReference(shifted, ref);
  assert.ok(c.meanErrBh! > 0.15, 'a 40 px shift on a ~220 px body is a large error');
  assert.equal(c.pck10, 0);
  const s = summarize(ref);
  assert.equal(s.detectedPct, 100); assert.equal(s.msP50, 10); assert.equal(s.fpsSustained, 100);
  assert.ok(s.peakWristBhPerS! > 0);
  const missing = ref.map((f, i) => (i % 2 ? { ...f, kps: null } : f));
  assert.equal(summarize(missing).detectedPct, 50);
});

test('containRect: a portrait clip in a wide box is pillarboxed, scale from the height (the overlay bug seen on the phone)', () => {
  const r = containRect(867, 760, 1080, 1920);
  assert.ok(Math.abs(r.scale - 760 / 1920) < 1e-9);
  assert.ok(Math.abs(r.w - 1080 * 760 / 1920) < 1e-6);
  assert.ok(Math.abs(r.x - (867 - r.w) / 2) < 1e-6 && r.y === 0);
  const wide = containRect(400, 600, 1920, 1080);
  assert.ok(Math.abs(wide.scale - 400 / 1920) < 1e-9 && wide.x === 0 && wide.y > 0);
});
