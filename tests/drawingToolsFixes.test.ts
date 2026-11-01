import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampColumnPos, dataColumnHit, TOUCH_TARGET_PX } from '../lib/drawingTools';

const col = { x: 100, y: 50, w: 150, h: 120 };

test('data column: the header drags; on a finger the band is at least 44 px', () => {
  assert.equal(dataColumnHit({ x: 120, y: 60 }, col, { headerH: 26, touch: false, selected: false }), 'header');
  assert.equal(dataColumnHit({ x: 120, y: 85 }, col, { headerH: 26, touch: false, selected: false }), null, 'mouse: 26 px header');
  assert.equal(dataColumnHit({ x: 120, y: 50 + TOUCH_TARGET_PX - 1 }, col, { headerH: 26, touch: true, selected: false }), 'header');
  assert.equal(dataColumnHit({ x: 90, y: 60 }, col, { headerH: 26, touch: true, selected: false }), null, 'left of the column');
});

test('data column: the corner resizes only while selected; 44 px square on a finger', () => {
  const corner = { x: 250, y: 170 };
  assert.equal(dataColumnHit(corner, col, { headerH: 26, touch: true, selected: false }), null, 'not selected: no grip, no resize');
  assert.equal(dataColumnHit(corner, col, { headerH: 26, touch: true, selected: true }), 'resize');
  assert.equal(dataColumnHit({ x: 250 + 21, y: 170 + 21 }, col, { headerH: 26, touch: true, selected: true }), 'resize');
  assert.equal(dataColumnHit({ x: 250 - 21, y: 170 - 21 }, col, { headerH: 26, touch: true, selected: true }), 'resize');
  assert.equal(dataColumnHit({ x: 250 + 21, y: 170 + 21 }, col, { headerH: 26, touch: false, selected: true }), null, 'mouse keeps the old small box');
  assert.equal(dataColumnHit({ x: 250 - 20, y: 170 - 20 }, col, { headerH: 26, touch: false, selected: true }), 'resize');
});

test('data column: dragging keeps it fully inside the video picture', () => {
  const canvas = { w: 1000, h: 600 };
  const video = { dx: 100, dy: 0, dw: 800, dh: 600 };
  const size = { w: 150, h: 120 };
  assert.deepEqual(clampColumnPos({ x: 0, y: 0 }, size, canvas, video), { x: 0.1, y: 0 });
  const far = clampColumnPos({ x: 0.99, y: 0.99 }, size, canvas, video);
  assert.equal(far.x * canvas.w, 900 - 150);
  assert.equal(far.y * canvas.h, 600 - 120);
  assert.deepEqual(clampColumnPos({ x: 0.5, y: 0.5 }, size, canvas, video), { x: 0.5, y: 0.5 }, 'inside: unchanged');
  assert.deepEqual(clampColumnPos({ x: 0.5, y: 0.5 }, size, canvas, null), { x: 0.5, y: 0.5 }, 'no video box: canvas');
});

test('wiring: Select is exempt from the precision anchor; the column is checked before it', () => {
  const c = readFileSync('components/Canvas.tsx', 'utf8');
  const elig = c.slice(c.indexOf('const precisionTouchEligible ='), c.indexOf('const precisionTouchEligible =') + 300);
  assert.match(elig, /toolEarly !== 'select'/);
  assert.ok(c.indexOf('const hit = dataColumnHit(posEarly') < c.indexOf('const precisionTouchEligible ='), 'column before precision');
  assert.doesNotMatch(c, /Data column HEADER drag \+ RESIZE corner \(BEFORE pan\) ─/, 'the old late copy is gone');
});

test('wiring: a finger on the Text tool cancels the pointerdown (no stray mousedown blurring the new box)', () => {
  const c = readFileSync('components/Canvas.tsx', 'utf8');
  assert.match(c, /if \(tool === 'text' && e\.pointerType !== 'mouse'\) e\.preventDefault\(\);\n\s*beginDrawToolAt\(pos, lw\);/);
});

test('toolbar: Text is first after Style in the Draw list; Text size is first in Style', () => {
  const t = readFileSync('components/ToolPalette.tsx', 'utf8');
  assert.ok(t.indexOf('k="text"') < t.indexOf('k="pen"'));
  const style = t.slice(t.indexOf("if (top === 'style')"), t.indexOf("if (top === 'draw')"));
  assert.ok(style.indexOf('Text size') < style.indexOf('Preset colors'));
});
