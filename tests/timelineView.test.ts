import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_TRIM_GAP, TRACK_INSET_PX, beginTrimDrag, dragTrimTo, fitView, resolveView, secondsPerPx,
  shouldAutoFit, timeAtClientX, zoomView, type TimeRange,
} from '@/lib/timelineView';

const TRACK = { left: 100, width: 820 }; // 800 px of usable track between the insets
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('pointer x → time uses the drawn inset and the current zoom', () => {
  const full = resolveView(null, 8);
  near(timeAtClientX(TRACK.left + TRACK_INSET_PX, TRACK, full, 8), 0);
  near(timeAtClientX(TRACK.left + TRACK_INSET_PX + 400, TRACK, full, 8), 4);
  near(timeAtClientX(TRACK.left + TRACK.width - TRACK_INSET_PX, TRACK, full, 8), 8);
  const zoomed: TimeRange = { start: 2, end: 3 };
  near(timeAtClientX(TRACK.left + TRACK_INSET_PX + 400, TRACK, zoomed, 8), 2.5);
  near(secondsPerPx(zoomed, TRACK.width), 1 / 800);
});

test('changing zoom never changes the selection (and needs no selection)', () => {
  const selection = Object.freeze({ start: 1.2, end: 3.4 });
  let view: TimeRange | null = null;
  for (const f of [0.65, 0.65, 0.65, 1.5, 0.65, 1.5, 1.5, 1.5]) {
    view = zoomView(view, 8, f, 6.5); // playhead far from the selection
    assert.deepEqual(selection, { start: 1.2, end: 3.4 });
  }
  const v = zoomView({ start: 0, end: 8 }, 8, 0.01, 6.5)!;
  near(v.end - v.start, 0.08, 1e-12); // clamped to the minimum span
  assert.ok(v.start >= 0 && v.end <= 8);
});

test('moving the selection never changes zoom: a handle drag never asks for a re-fit', () => {
  assert.equal(shouldAutoFit({ fitOn: true, dragging: true, alreadyFitted: true, fittedSpan: 2, newSpan: 7 }), false);
  assert.equal(shouldAutoFit({ fitOn: false, dragging: false, alreadyFitted: false, fittedSpan: 0, newSpan: 2 }), false);
  assert.equal(shouldAutoFit({ fitOn: true, dragging: false, alreadyFitted: false, fittedSpan: 0, newSpan: 2 }), true, 'one fit on entry');
  assert.equal(shouldAutoFit({ fitOn: true, dragging: false, alreadyFitted: true, fittedSpan: 2, newSpan: 2.4 }), false);
  assert.equal(shouldAutoFit({ fitOn: true, dragging: false, alreadyFitted: true, fittedSpan: 2, newSpan: 8 }), true, '"Use full video"');
});

test('handle drag: pixels → seconds at the current zoom, for a short and a long video', () => {
  for (const { dur, view } of [
    { dur: 2, view: { start: 0, end: 2 } },
    { dur: 2, view: { start: 0.9, end: 1.0 } },
    { dur: 600, view: { start: 0, end: 600 } },
    { dur: 600, view: { start: 300, end: 301 } },
  ]) {
    const sel = { start: view.start + (view.end - view.start) * 0.2, end: view.start + (view.end - view.start) * 0.8 };
    let drag = beginTrimDrag('end', sel, 500);
    drag = dragTrimTo(drag, 540, view, TRACK.width, dur); // +40 px
    near(drag.end - sel.end, 40 * (view.end - view.start) / 800, 1e-9);
    assert.equal(drag.start, sel.start, 'the other handle never moves');
    drag = beginTrimDrag('start', sel, 500);
    drag = dragTrimTo(drag, 470, view, TRACK.width, dur); // −30 px
    near(sel.start - drag.start, 30 * (view.end - view.start) / 800, 1e-9);
    assert.equal(drag.end, sel.end);
  }
});

test('the stuck case: selection outside the zoomed view — handles still move, nothing collapses', () => {
  // Zoomed in on 6.0–6.5 s; the selection 1–2 s is off to the left, so both
  // handles are drawn pinned at the left edge. The old absolute mapping set the
  // start to the edge time (6.0) and clamped it against the end (2.0): stuck.
  const view = { start: 6, end: 6.5 };
  const sel = { start: 1, end: 2 };
  let d = beginTrimDrag('start', sel, TRACK.left + TRACK_INSET_PX);
  d = dragTrimTo(d, TRACK.left + TRACK_INSET_PX + 80, view, TRACK.width, 8);
  near(d.start, 1 + 80 * 0.5 / 800);
  assert.equal(d.end, 2);
  let e = beginTrimDrag('end', sel, TRACK.left + TRACK_INSET_PX);
  e = dragTrimTo(e, TRACK.left + TRACK_INSET_PX - 40, view, TRACK.width, 8);
  near(e.end, 2 - 40 * 0.5 / 800);
  assert.equal(e.start, 1);
});

test('handles never cross, and coming back after hitting the limit is exact', () => {
  const sel = { start: 1, end: 2 };
  const view = { start: 0, end: 8 }; // 0.01 s per px
  let d = beginTrimDrag('start', sel, 0);
  d = dragTrimTo(d, 300, view, TRACK.width, 8); // would be 4 s: stops at end − gap
  near(d.start, 2 - MIN_TRIM_GAP);
  d = dragTrimTo(d, 50, view, TRACK.width, 8); // back to +50 px from the press
  near(d.start, 1.5);
  let e = beginTrimDrag('end', sel, 0);
  e = dragTrimTo(e, 10_000, view, TRACK.width, 8);
  assert.equal(e.end, 8);
});

test('zoom changing mid-drag: later movement uses the new zoom, no jump', () => {
  const sel = { start: 1, end: 2 };
  let d = beginTrimDrag('end', sel, 400);
  d = dragTrimTo(d, 420, { start: 0, end: 8 }, TRACK.width, 8); // +20 px @ 0.01 s/px
  near(d.end, 2.2);
  d = dragTrimTo(d, 420, { start: 2, end: 2.8 }, TRACK.width, 8); // zoom changed, pointer still
  near(d.end, 2.2);
  d = dragTrimTo(d, 440, { start: 2, end: 2.8 }, TRACK.width, 8); // +20 px @ 0.001 s/px
  near(d.end, 2.22);
});

test('fit frames the selection with padding inside the clip', () => {
  assert.deepEqual(fitView({ start: 0, end: 8 }, 8), { start: 0, end: 8 });
  const f = fitView({ start: 3, end: 4 }, 8);
  near(f.start, 2.88); near(f.end, 4.12);
});
