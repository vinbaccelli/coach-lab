import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_BUTTON_SIZE_PX as S, reportButtonPosition, type Box, type Insets, type Viewport } from '@/lib/reportButtonPlacement';

const none: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const vp = (width: number, height: number): Viewport => ({ offsetTop: 0, offsetLeft: 0, width, height });
const overlap = (a: { top: number; left: number }, b: Box) =>
  a.left < b.left + b.width && a.left + S > b.left && a.top < b.top + b.height && a.top + S > b.top;

// Portrait 390×844: row at the top right (30 px tall), zoom stack 36×162 at right 12, bottom 92.
const rowP: Box = { top: 8, left: 250, width: 132, height: 30 };
const stackP: Box = { top: 844 - 92 - 162, left: 390 - 12 - 36, width: 36, height: 162 };
// Landscape 844×390: the same row, the stack's bottom edge 92 px up → top 136.
const rowL: Box = { top: 8, left: 702, width: 132, height: 30 };
const stackL: Box = { top: 390 - 92 - 162, left: 844 - 12 - 36, width: 36, height: 162 };

test('portrait: below the top-right row, in the zoom stack column, clear of both', () => {
  const p = reportButtonPosition(vp(390, 844), none, rowP, stackP);
  assert.equal(p.top, 8 + 30 + 6);
  assert.equal(p.left, stackP.left + 1);
  assert.equal(overlap(p, rowP), false);
  assert.equal(overlap(p, stackP), false);
});

test('landscape 844×390: still visible, inside the screen, clear of the row and the stack', () => {
  const p = reportButtonPosition(vp(844, 390), none, rowL, stackL);
  assert.ok(p.top >= 0 && p.top + S <= 390 && p.left >= 0 && p.left + S <= 844);
  assert.equal(overlap(p, rowL), false);
  assert.equal(overlap(p, stackL), false);
});

test('too little room between row and stack: beside the stack, still on screen', () => {
  const tall: Box = { top: 8, left: 702, width: 132, height: 90 }; // wrapped row
  const p = reportButtonPosition(vp(844, 390), none, tall, stackL);
  assert.equal(p.left, stackL.left - 6 - S);
  assert.equal(overlap(p, stackL), false);
  assert.equal(overlap(p, tall), false);
  assert.ok(p.top + S <= 390);
});

test('safe-area insets and the visual viewport keep it inside the visible screen', () => {
  const ins: Insets = { top: 47, right: 47, bottom: 21, left: 47 };
  const p = reportButtonPosition(vp(844, 390), ins, null, null);
  assert.ok(p.top >= 47 + 8 && p.left + S <= 844 - 47 - 8);
  // Pinch-zoomed: the visible area starts at (100, 60) and is 300 wide.
  const z = reportButtonPosition({ offsetTop: 60, offsetLeft: 100, width: 300, height: 400 }, none, null, null);
  assert.ok(z.left >= 100 && z.left + S <= 400 && z.top >= 60 && z.top + S <= 460);
});

test('no row and no stack (other pages): top-right corner', () => {
  const p = reportButtonPosition(vp(390, 844), none, null, null);
  assert.deepEqual(p, { top: 8, left: 390 - 12 - S });
});

test('hidden or invalid boxes are ignored', () => {
  const p = reportButtonPosition(vp(390, 844), none, { top: 0, left: 0, width: 0, height: 0 }, { top: NaN, left: 0, width: 36, height: 100 });
  assert.deepEqual(p, { top: 8, left: 390 - 12 - S });
});

import { LANDSCAPE_CLEARANCE_PX as CL, boxGap, isLandscape, reportButtonPositionLandscape } from '@/lib/reportButtonPlacement';

// Landscape 844×390, measured rects (not estimated widths): row = [record, trash, +B] buttons top right,
// zoom stack = help, +, −, ⌂ (36 px buttons, 6 px gaps) at right 12, bottom edge 92 px up.
const btn = (left: number, top: number, w = 34, h = 30): Box => ({ left, top, width: w, height: h });
const rowL2: Box[] = [
  { left: 640, top: 8, width: 196, height: 30 }, // the container
  btn(640, 8), btn(682, 8, 40), btn(730, 8, 106),   // record, trash, +B (wide pill)
];
const stackBtns: Box[] = [0, 1, 2, 3].map((i) => ({ left: 844 - 12 - 36, top: 136 + i * 42, width: 36, height: 36 }));
const stackBox: Box = { left: 796, top: 136, width: 36, height: 162 };

test('landscape: left of the leftmost row button, ≥ 12 px from every measured box, not between trash and +B', () => {
  const p = reportButtonPositionLandscape(vp(844, 390), none, rowL2, [stackBox, ...stackBtns]);
  const me: Box = { top: p.top, left: p.left, width: S, height: S };
  for (const r of [...rowL2, stackBox, ...stackBtns]) assert.ok(boxGap(me, r) >= CL, `gap to ${JSON.stringify(r)} = ${boxGap(me, r)}`);
  assert.ok(p.left + S <= 640 - CL, 'left of the whole row');
  assert.ok(isLandscape(vp(844, 390)) && !isLandscape(vp(390, 844)));
});

test('landscape: no room left of the row → right edge below the home button, still ≥ 12 px clear', () => {
  const crowded: Box[] = [{ left: 20, top: 8, width: 816, height: 30 }, btn(20, 8, 800)];
  const p = reportButtonPositionLandscape(vp(844, 390), none, crowded, [stackBox, ...stackBtns]);
  const me: Box = { top: p.top, left: p.left, width: S, height: S };
  for (const r of [...crowded, stackBox, ...stackBtns]) assert.ok(boxGap(me, r) >= CL);
  assert.ok(p.top >= 136 + 162 + CL);
  assert.ok(p.top + S <= 390);
});

test('landscape: honours safe-area insets and stays on screen even when nothing is clear', () => {
  const ins: Insets = { top: 0, right: 47, bottom: 21, left: 47 };
  const p = reportButtonPositionLandscape(vp(844, 390), ins, [{ left: 0, top: 0, width: 844, height: 390 }], [stackBox]);
  assert.ok(p.left >= 47 + 8 && p.left + S <= 844 - 47 - 8 && p.top >= 8 && p.top + S <= 390 - 21 - 8);
});

test('landscape: no measured boxes → top-right corner', () => {
  assert.deepEqual(reportButtonPositionLandscape(vp(844, 390), none, [], []), { top: 8, left: 844 - 12 - S });
});

test('portrait placement is unchanged by the landscape code', () => {
  const p = reportButtonPosition(vp(390, 844), none, rowP, stackP);
  assert.deepEqual(p, { top: 44, left: stackP.left + 1 });
});
