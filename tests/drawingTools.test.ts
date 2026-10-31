import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARROW_HEAD_HALF_ANGLE, SWING_TIME_EPS, arrowHeadGeometry, arrowHeadLength, swingPathVisibleAt,
} from '../lib/drawingTools';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── Bug A: arrowheads ─────────────────────────────────────────────────────────

test('arrow: the line ends exactly at the middle of the head base, on the arrow axis, at any angle', () => {
  for (let deg = 0; deg < 360; deg += 15) {
    const a = (deg * Math.PI) / 180;
    const from = { x: 100, y: 100 };
    const tip = { x: 100 + 200 * Math.cos(a), y: 100 + 200 * Math.sin(a) };
    const g = arrowHeadGeometry(from, tip, 20)!;
    assert.ok(g.shaftEnd, `shaft at ${deg}°`);
    assert.deepEqual(g.shaftEnd, g.base);
    // On the axis, between the start and the tip, head length × cos(half angle) behind the tip.
    assert.ok(close(dist(from, g.base) + dist(g.base, tip), dist(from, tip), 1e-6), `on the axis at ${deg}°`);
    assert.ok(close(dist(g.base, tip), 20 * Math.cos(ARROW_HEAD_HALF_ANGLE), 1e-9));
    // The base is the midpoint of the head's back corners.
    assert.ok(close((g.left.x + g.right.x) / 2, g.base.x, 1e-9) && close((g.left.y + g.right.y) / 2, g.base.y, 1e-9));
  }
});

test('arrow: the head is always wider than the line at its base, for every line width (arrow 1–12 px, swing path)', () => {
  for (let lw = 1; lw <= 12; lw++) {
    for (const [min, per] of [[14, 2], [12, 3]] as const) {
      const g = arrowHeadGeometry({ x: 0, y: 0 }, { x: 300, y: 40 }, arrowHeadLength(lw, min, per))!;
      const halfBase = dist(g.left, g.right) / 2;
      assert.ok(halfBase > lw / 2, `lw ${lw} (${min}, ${per}): head half-base ${halfBase.toFixed(2)} > ${lw / 2}`);
    }
  }
});

test('arrow: head length keeps the old size for thin lines and grows with thick ones', () => {
  assert.equal(arrowHeadLength(4, 14, 2), 14, 'old 14 px head unchanged up to 7 px');
  assert.equal(arrowHeadLength(7, 14, 2), 14);
  assert.equal(arrowHeadLength(12, 14, 2), 24);
  assert.equal(arrowHeadLength(4, 12, 3), 12, 'swing path: the old max(12, 3 × width)');
  assert.equal(arrowHeadLength(6, 12, 3), 18);
  assert.equal(arrowHeadLength(Number.NaN, 14, 2), 14);
});

test('arrow: an arrow no longer than its head has no line; coinciding points have no head', () => {
  const g = arrowHeadGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, 14)!;
  assert.equal(g.shaftEnd, null);
  assert.equal(arrowHeadGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 14), null);
});

test('arrow: the screen and the generated video draw arrows with the same function', () => {
  const src = readFileSync('components/Canvas.tsx', 'utf8');
  // The export draws every stroke through drawStroke, the screen's own function.
  assert.match(src, /for \(const st of frozen\.strokes as Stroke\[\]\) drawStroke\(ctx, st, tick, jointBallR, mediaTime\)/);
  assert.match(src, /for \(const st of hold\.strokes as Stroke\[\]\) drawStroke\(ctx, st, tick, jointBallR, mediaTime\)/);
  assert.equal((src.match(/arrowHeadGeometry\(/g) ?? []).length, 2, 'arrow tools + swing path end arrow');
  assert.doesNotMatch(src, /function drawArrowHead/);
});

// ── Bug B: swing path time range ──────────────────────────────────────────────

const times = [1.2, 1.35, 1.5, 1.8];

test('swing path: hidden before the first click time', () => {
  assert.equal(swingPathVisibleAt(times, 0), false);
  assert.equal(swingPathVisibleAt(times, 1.2 - 2 * SWING_TIME_EPS), false);
});

test('swing path: shown at the first click time, in between, and at the last', () => {
  assert.equal(swingPathVisibleAt(times, 1.2), true);
  assert.equal(swingPathVisibleAt(times, 1.2 - SWING_TIME_EPS / 2), true, 'within the 1 ms tolerance');
  assert.equal(swingPathVisibleAt(times, 1.42), true);
  assert.equal(swingPathVisibleAt(times, 1.8), true);
});

test('swing path: hidden after the last click time', () => {
  assert.equal(swingPathVisibleAt(times, 1.8 + 2 * SWING_TIME_EPS), false);
  assert.equal(swingPathVisibleAt(times, 10), false);
});

test('swing path: an old path without click times is always shown', () => {
  assert.equal(swingPathVisibleAt(undefined, 0), true);
  assert.equal(swingPathVisibleAt(undefined, 99), true);
  assert.equal(swingPathVisibleAt([], 5), true);
  assert.equal(swingPathVisibleAt([Number.NaN], 5), true);
});

test('swing path: a single click is shown at its own time only', () => {
  assert.equal(swingPathVisibleAt([2], 2), true);
  assert.equal(swingPathVisibleAt([2], 1.9), false);
  assert.equal(swingPathVisibleAt([2], 2.1), false);
});

test('swing path: clicks placed while stepping backwards still cover their whole span', () => {
  assert.equal(swingPathVisibleAt([1.8, 1.5, 1.2], 1.3), true);
  assert.equal(swingPathVisibleAt([1.8, 1.5, 1.2], 1.9), false);
});

test('swing path: no frame time known (no video clock) draws it as before', () => {
  assert.equal(swingPathVisibleAt(times, undefined), true);
  assert.equal(swingPathVisibleAt(times, Number.NaN), true);
});

test('swing path wiring: clicks record the video time; the in-progress path is drawn without the range; hold frames use the hold time', () => {
  const src = readFileSync('components/Canvas.tsx', 'utf8');
  assert.match(src, /manualSwingTimesRef\.current = \[\.\.\.manualSwingTimesRef\.current, drawingVideoTime\(\)\]/);
  assert.match(src, /times: clickTimes\(manualSwingTimesRef\.current, pts\.length\)/);
  // The path being drawn is the separate drawSmoothPath call (no time check).
  assert.match(src, /if \(manualSwingActiveRef\.current && manualSwingPtsRef\.current\.length > 0\) \{\s*const pts = manualSwingPtsRef\.current;\s*const opts = drawingOptsRef\.current;\s*drawSmoothPath\(/);
  // The export calls a hold frame with the hold's own media time (lib/cropExport.ts).
  const crop = readFileSync('lib/cropExport.ts', 'utf8');
  assert.match(crop, /runOverlay\(drawOverlay, ctx, h\.at, ow, oh, h\.index\)/);
});
