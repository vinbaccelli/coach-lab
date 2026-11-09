import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeHoldMove, PRECISION_HOLD_MS, PRECISION_HOLD_SLOP_PX, PRECISION_HOLD_MAX_TRAVEL_PX, type HoldPoints } from '../lib/precisionHold';

const press = (x = 100, y = 100): HoldPoints => ({ clientX: x, clientY: y, lastX: x, lastY: y });
/** Feed a sequence of move samples; returns the first cancel reason or null. */
const run = (h: HoldPoints, pts: Array<[number, number]>) => {
  for (const [x, y] of pts) { const v = judgeHoldMove(h, x, y); if (!v.keep) return v.reason; }
  return null;
};

test('constants are the tuned values (2 s, 10 px per step, 44 px total)', () => {
  assert.equal(PRECISION_HOLD_MS, 2000);
  assert.equal(PRECISION_HOLD_SLOP_PX, 10);
  assert.equal(PRECISION_HOLD_MAX_TRAVEL_PX, 44);
});

test('a finger that settles on the glass (small steps, ~12 px total) keeps the hold: the old origin-only rule cancelled this', () => {
  assert.equal(run(press(), [[103, 100], [106, 101], [109, 101], [111, 102], [112, 102]]), null);
});

test('a slow creep of 20 px in small steps keeps the hold (still under the total cap)', () => {
  const pts: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [100 + i + 1, 100]);
  assert.equal(run(press(), pts), null);
});

test('one real stroke step (> 10 px between samples) cancels, with the step in the reason', () => {
  const r = run(press(), [[103, 100], [120, 100]]);
  assert.match(r ?? '', /moved 17 px in one step/);
});

test('an arbitrarily slow deliberate drag is capped by the total travel (cancels on the first sample past 44 px from the press)', () => {
  const h = press();
  let cancelledAt = -1;
  let reason = '';
  for (let i = 1; i <= 60; i++) {
    const v = judgeHoldMove(h, 100 + i * 0.9, 100); // 0.9 px per step: never trips the per-step limit
    if (!v.keep) { cancelledAt = i; reason = v.reason; break; }
  }
  assert.equal(cancelledAt, 49, '49 * 0.9 = 44.1 px is the first sample past the 44 px cap');
  assert.match(reason, /drifted \d+ px from the press \(limit 44\)/);
});

test('an accepted move re-anchors the reference; a rejected one does not matter (the hold is dead)', () => {
  const h = press();
  assert.equal(judgeHoldMove(h, 108, 100).keep, true);
  assert.equal(h.lastX, 108);
  assert.equal(judgeHoldMove(h, 130, 100).keep, false);
});
