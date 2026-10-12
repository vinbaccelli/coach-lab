import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERASER_PRESETS, ERASER_SIZE_DEFAULT, ERASER_SIZE_MAX, ERASER_SIZE_MIN,
  clampEraserSize, eraseUnderRing, eraserPresetFor, type EraserDot,
} from '@/lib/eraser';

// A horizontal line mark at height y: its outline distance from a point is |dy|.
type Mark = { tool: string; y: number; lw?: number; eraserStrokes?: EraserDot[] };
const TEST = {
  eligible: (s: Mark) => s.tool !== 'text',
  distance: (s: Mark, pos: { x: number; y: number }) => Math.abs(pos.y - s.y),
};
const line = (y: number, lw = 2): Mark => Object.freeze({ tool: 'line', y, lw }) as Mark;

test('default size is unchanged (15px) and is the Medium preset', () => {
  assert.equal(ERASER_SIZE_DEFAULT, 15);
  assert.equal(eraserPresetFor(ERASER_SIZE_DEFAULT), 'medium');
  assert.deepEqual(ERASER_PRESETS.map((p) => p.id), ['small', 'medium', 'large']);
  const sizes = ERASER_PRESETS.map((p) => p.size);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b), 'presets grow small → large');
  for (const s of sizes) assert.ok(s >= ERASER_SIZE_MIN && s <= ERASER_SIZE_MAX, `${s} inside the slider range`);
});

test('size changes: slider values are clamped to whole px in range; presets are recognised', () => {
  assert.equal(clampEraserSize(4), ERASER_SIZE_MIN);
  assert.equal(clampEraserSize(51), ERASER_SIZE_MAX);
  assert.equal(clampEraserSize(12.6), 13);
  assert.equal(clampEraserSize(Number.NaN), ERASER_SIZE_DEFAULT);
  assert.equal(eraserPresetFor(8), 'small');
  assert.equal(eraserPresetFor(30), 'large');
  assert.equal(eraserPresetFor(22), null);
});

test('the erase radius is the chosen size: dot radius and reach both follow it', () => {
  const marks = [line(0), line(20)];
  // Ring at y=0. Mark at y=20 (lw 2) is reached when size + 1 >= 20.
  for (const { size, cutsFar } of [{ size: 8, cutsFar: false }, { size: 15, cutsFar: false }, { size: 19, cutsFar: true }, { size: 30, cutsFar: true }]) {
    const r = eraseUnderRing(marks, { x: 5, y: 0 }, size, TEST);
    assert.deepEqual(r.cut, cutsFar ? [0, 1] : [0], `size ${size}`);
    for (const i of r.cut) assert.deepEqual(r.strokes[i].eraserStrokes, [{ x: 5, y: 0, radius: size }]);
  }
  // Exactly on the edge (distance = size + lw/2) still cuts; one px further does not.
  assert.deepEqual(eraseUnderRing([line(16)], { x: 0, y: 0 }, 15, TEST).cut, [0]);
  assert.deepEqual(eraseUnderRing([line(17)], { x: 0, y: 0 }, 15, TEST).cut, []);
});

test('nothing is cut when disarmed (size 0), for ineligible marks, or on a bad distance', () => {
  assert.deepEqual(eraseUnderRing([line(0)], { x: 0, y: 0 }, 0, TEST).cut, []);
  assert.deepEqual(eraseUnderRing([{ tool: 'text', y: 0 }], { x: 0, y: 0 }, 30, TEST).cut, []);
  assert.deepEqual(eraseUnderRing([line(0)], { x: 0, y: 0 }, 30, { ...TEST, distance: () => Number.NaN }).cut, []);
});

test('Undo: a whole drag is one step — the snapshot from before the drag is never mutated', () => {
  const before = [line(0), line(100), line(200)];
  const history: Mark[][] = [[...before]]; // what Canvas pushes before the drag
  let live: Mark[] = [...before];
  // One drag across the first mark, five moves, size changed to Large beforehand.
  const size = ERASER_PRESETS.find((p) => p.id === 'large')!.size;
  for (const x of [0, 10, 20, 30, 40]) live = eraseUnderRing(live, { x, y: 3 }, size, TEST).strokes;
  history.push([...live]); // the single push on lift
  assert.equal(history.length, 2, 'one drag added exactly one history entry');
  assert.equal(live[0].eraserStrokes?.length, 5);
  assert.ok(live[0].eraserStrokes!.every((d) => d.radius === size));
  assert.equal(live[1], before[1], 'untouched marks keep their identity');
  // Undo = back to the previous entry: the original, uncut objects.
  const undone = history[history.length - 2];
  assert.equal(undone[0], before[0]);
  assert.equal(undone[0].eraserStrokes, undefined);
  // A later drag at a smaller size records its own radius, again in one step.
  const small = ERASER_PRESETS[0].size;
  const after = eraseUnderRing(live, { x: 0, y: 100 }, small, TEST).strokes;
  assert.deepEqual(after[1].eraserStrokes, [{ x: 0, y: 100, radius: small }]);
  assert.equal(after[0], live[0]);
});
