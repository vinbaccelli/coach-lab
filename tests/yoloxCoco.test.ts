import test from 'node:test';
import assert from 'node:assert/strict';
import { bestPersonYoloxCoco } from '../lib/rtmpose/core';

// Raw (non grid-decoded) output of the stock YOLOX-tiny COCO ONNX: [N,85] = tx,ty,tw,th,obj,cls0..79; anchors 52² (stride 8), 26² (16), 13² (32).
const N = 52 * 52 + 26 * 26 + 13 * 13;
function blank(): Float32Array { return new Float32Array(N * 85); }
function put(out: Float32Array, i: number, v: { tx: number; ty: number; tw: number; th: number; obj: number; person: number }) {
  const o = i * 85;
  out[o] = v.tx; out[o + 1] = v.ty; out[o + 2] = v.tw; out[o + 3] = v.th; out[o + 4] = v.obj; out[o + 5] = v.person;
}

test('bestPersonYoloxCoco grid-decodes the stride-16 anchor and maps back to frame pixels', () => {
  const out = blank();
  // stride 16, grid cell (gx=10, gy=5): centre = (10+0.5)*16 = 168, (5+0.5)*16 = 88; size = e^1 * 16 ≈ 43.5
  put(out, 52 * 52 + 5 * 26 + 10, { tx: 0.5, ty: 0.5, tw: 1, th: 2, obj: 0.9, person: 0.9 });
  const b = bestPersonYoloxCoco(out, 0.5)!;
  assert.ok(Math.abs(b.x - (168 - Math.E * 8) / 0.5) < 1e-3);
  assert.ok(Math.abs(b.y - (88 - Math.exp(2) * 8) / 0.5) < 1e-3);
  assert.ok(Math.abs(b.w - (Math.E * 16) / 0.5) < 1e-3);
});

test('bestPersonYoloxCoco: below-threshold and non-person boxes are ignored; the followed player wins over a more confident one', () => {
  const out = blank();
  assert.equal(bestPersonYoloxCoco(out, 1), null, 'nothing detected');
  put(out, 0, { tx: 0, ty: 0, tw: 1, th: 1, obj: 0.4, person: 0.4 }); // 0.16 < 0.3
  assert.equal(bestPersonYoloxCoco(out, 1), null, 'objectness × class below minScore');
  // two confident people on the stride-32 grid, far apart
  const base = 52 * 52 + 26 * 26;
  put(out, base + 0, { tx: 0.5, ty: 0.5, tw: 1, th: 1, obj: 0.95, person: 0.95 });
  put(out, base + 12, { tx: 0.5, ty: 0.5, tw: 1, th: 1, obj: 0.6, person: 0.7 });
  const top = bestPersonYoloxCoco(out, 1)!;
  const followed = bestPersonYoloxCoco(out, 1, 0.3, { x: 12 * 32, y: 0, w: 90, h: 90 })!;
  assert.ok(followed.x > top.x + 300, 'overlapping person chosen when a previous box is given');
});
