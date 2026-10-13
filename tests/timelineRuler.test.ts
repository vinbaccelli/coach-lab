import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_LAND_AT, MIN_VIEW_SPAN, RULER_MIN_LABEL_PX, TRACK_INSET_PX, centerViewOn, clampView, followPlayhead,
  formatRulerTime, nextFollow, panView, pinchView, resolveView, rulerLabelWidthPx, rulerTicks, timeAtClientX,
  zoomAt, type TimeRange,
} from '@/lib/timelineView';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const TWO_H = 7200;

/** Every ruler invariant at one zoom level: spacing, no overlap, inside the track, increasing, in view. */
function checkRuler(view: TimeRange, width: number, fps: number, dur: number) {
  const r = rulerTicks(view, width, fps, dur);
  assert.ok(r.ticks.length >= 1, `at least one label for ${JSON.stringify(view)} @ ${width}px`);
  for (let i = 0; i < r.ticks.length; i++) {
    const k = r.ticks[i];
    assert.ok(k.t >= view.start - 1e-6 && k.t <= view.end + 1e-6, 'tick inside the view');
    assert.ok(k.x >= TRACK_INSET_PX - 1e-6, 'tick inside the track');
    assert.ok(k.x + rulerLabelWidthPx(k.label) <= width, `label "${k.label}" stays inside ${width}px`);
    if (i > 0) {
      const prev = r.ticks[i - 1];
      assert.ok(k.x - prev.x >= RULER_MIN_LABEL_PX - 1e-6, `labels ≥ ${RULER_MIN_LABEL_PX}px apart`);
      assert.ok(prev.x + rulerLabelWidthPx(prev.label) <= k.x, `"${prev.label}" and "${k.label}" do not overlap`);
    }
  }
  if (r.minorStep) assert.ok(r.minorPx >= 7 - 1e-9 && r.minorStep < r.step);
  return r;
}

test('ruler: readable at every zoom, whole 2-hour clip down to single frames, at 390 px and 1440 px', () => {
  for (const width of [370, 1400]) {
    for (const dur of [2, 1800, 3600, TWO_H]) {
      let view: TimeRange = { start: 0, end: dur };
      // From the whole clip, zoom in ×0.65 around a point near the middle until the minimum span.
      for (let i = 0; i < 80; i++) {
        checkRuler(view, width, 30, dur);
        const next = zoomAt(view, dur, 0.65, dur * 0.43, 0.43);
        if (!next || Math.abs(next.end - next.start - (view.end - view.start)) < 1e-12) break;
        view = next;
      }
      near(view.end - view.start, Math.min(MIN_VIEW_SPAN, dur));
    }
  }
});

test('ruler: steps grow with the span; frames when zoomed right in, hours for a whole long clip', () => {
  const whole = rulerTicks({ start: 0, end: TWO_H }, 1400, 30, TWO_H);
  assert.equal(whole.step, 600); // 10-minute labels over 1380 px
  assert.deepEqual(whole.ticks.slice(0, 3).map((k) => k.label), ['0:00:00', '0:10:00', '0:20:00']);
  const minute = rulerTicks({ start: 125, end: 185 }, 1400, 30, 1800);
  assert.equal(minute.step, 5);
  assert.deepEqual(minute.ticks.slice(0, 3).map((k) => k.label), ['2:05', '2:10', '2:15']);
  // 0.3 s across 1380 px at 30 fps: one frame is 153 px — every frame labelled.
  const frames = rulerTicks({ start: 4, end: 4.3 }, 1400, 30, 60);
  assert.equal(frames.stepFrames, 1);
  assert.deepEqual(frames.ticks.slice(0, 4).map((k) => k.label), ['0:04', '+1f', '+2f', '+3f']);
  // Same view on a phone: every other or fifth frame, never closer than the minimum.
  const phone = rulerTicks({ start: 4, end: 4.3 }, 370, 30, 60);
  assert.ok(phone.stepFrames > 1);
  // Ticks follow the zoom: a time sits at the x the track maps it to.
  const view = { start: 125, end: 185 };
  for (const k of minute.ticks) {
    near(timeAtClientX(k.x, { left: 0, width: 1400 }, view, 1800), k.t, 1e-9);
  }
  // 60 fps gets 60-fps frame steps; labels still whole seconds at the boundary.
  const f60 = rulerTicks({ start: 10, end: 10.2 }, 1400, 60, 60);
  assert.equal(f60.ticks[0].label, '0:10');
  near(f60.ticks[1].t - f60.ticks[0].t, f60.stepFrames / 60);
});

test('ruler time format: m:ss, and h:mm:ss on clips of an hour or more', () => {
  assert.equal(formatRulerTime(65, false), '1:05');
  assert.equal(formatRulerTime(3725, false), '1:02:05');
  assert.equal(formatRulerTime(65, true), '0:01:05');
});

test('zoom around a point: the time under the pointer stays under the pointer', () => {
  const dur = 1800;
  const view = { start: 100, end: 400 };
  const anchor = 250; // at 50 % of the view
  const z = zoomAt(view, dur, 0.5, anchor, 0.5)!;
  near(z.end - z.start, 150);
  near(z.start + 0.5 * (z.end - z.start), anchor);
  // Anchor near the left edge: still fixed at its fraction.
  const z2 = zoomAt(view, dur, 0.5, 130, 0.1)!;
  near(z2.start + 0.1 * (z2.end - z2.start), 130);
  // Zooming out past the clip returns the whole-clip view (null).
  assert.equal(zoomAt(view, dur, 100, 250, 0.5), null);
  // Clamped at the clip start: never negative.
  const z3 = zoomAt({ start: 0, end: 60 }, dur, 2, 5, 0.9)!;
  assert.ok(z3.start >= 0);
  near(z3.end - z3.start, 120);
  // Minimum span.
  const z4 = zoomAt({ start: 10, end: 10.1 }, dur, 0.01, 10.05, 0.5)!;
  near(z4.end - z4.start, MIN_VIEW_SPAN);
});

test('pinch: fingers apart zoom in around their midpoint; moving the midpoint pans', () => {
  const dur = 600;
  const start = { start: 100, end: 200 };
  const v = pinchView(start, dur, 100, 200, 150, 0.5)!; // fingers twice as far apart
  near(v.end - v.start, 50);
  near((v.start + v.end) / 2, 150);
  const panned = pinchView(start, dur, 100, 100, 150, 0.25)!; // same distance, midpoint moved left
  near(panned.end - panned.start, 100);
  near(panned.start + 0.25 * 100, 150);
});

test('scroll: pans by seconds, stays inside the clip, keeps the span; the whole-clip view has nothing to scroll', () => {
  const dur = TWO_H;
  const v = panView({ start: 1000, end: 1600 }, dur, 300)!;
  assert.deepEqual(v, { start: 1300, end: 1900 });
  assert.deepEqual(panView({ start: 100, end: 700 }, dur, -500), { start: 0, end: 600 });
  assert.deepEqual(panView({ start: 6900, end: 7100 }, dur, 500), { start: 7000, end: 7200 });
  assert.equal(panView(null, dur, 100), null);
  assert.deepEqual(centerViewOn({ start: 0, end: 600 }, dur, 3600), { start: 3300, end: 3900 });
  assert.equal(clampView({ start: -5, end: dur + 5 }, dur), null);
});

test('follow-playhead: pages only when the playhead passes 90 %, landing it at 10 %', () => {
  const dur = 1800;
  const view = { start: 100, end: 200 };
  assert.equal(followPlayhead(view, dur, 150), view, 'inside: same object, no update');
  assert.equal(followPlayhead(view, dur, 189.9), view);
  const paged = followPlayhead(view, dur, 191)!;
  near(paged.start, 191 - 100 * FOLLOW_LAND_AT);
  near(paged.end - paged.start, 100);
  // Behind the view (seek back): brought into view too.
  const back = followPlayhead(view, dur, 20)!;
  near(back.start, 10);
  // At the clip's end the view stops paging.
  const endView = { start: 1700, end: 1800 };
  assert.equal(followPlayhead(endView, dur, 1795), endView);
  assert.equal(followPlayhead(null, dur, 500), null, 'whole clip: nothing to follow');
  // Paused (after a seek): only a playhead OUTSIDE the view moves it.
  assert.equal(followPlayhead(view, dur, 195, 'reveal'), view, 'near the edge: the view stays put');
  assert.equal(followPlayhead(view, dur, 200, 'reveal'), view);
  near(followPlayhead(view, dur, 260, 'reveal')!.start, 250);
  // Over a whole 2-hour playback at a 60 s view the view changes ~150 times, not every update.
  let v: TimeRange | null = { start: 0, end: 60 };
  let changes = 0;
  for (let t = 0; t <= TWO_H; t += 0.1) {
    const n = followPlayhead(v, TWO_H, t);
    if (n !== v) changes++;
    v = n;
  }
  assert.ok(changes > 100 && changes < 160, `${changes} page turns`);
});

test('follow state: a hand scroll/zoom pauses it; play or a seek turns it back on', () => {
  assert.equal(nextFollow('manual-view'), false);
  assert.equal(nextFollow('play'), true);
  assert.equal(nextFollow('seek'), true);
});

test('view changes never touch a selection (PR #81 rule)', () => {
  const selection = Object.freeze({ start: 1200, end: 1260 });
  let view: TimeRange | null = { start: 1000, end: 2000 };
  view = zoomAt(view, TWO_H, 0.3, 4000, 0.9);
  view = panView(view, TWO_H, -800);
  view = pinchView(view, TWO_H, 50, 150, 300, 0.2);
  view = followPlayhead(view, TWO_H, 5000);
  view = centerViewOn(view, TWO_H, 7000);
  assert.deepEqual(selection, { start: 1200, end: 1260 });
  assert.ok(resolveView(view, TWO_H).end <= TWO_H);
});
