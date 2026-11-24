import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DoubleTapDetector } from '../lib/precisionHold';

test('two quick taps in the same spot complete a double-tap', () => {
  const d = new DoubleTapDetector();
  d.press(0, 100, 100); assert.equal(d.lift(80, 100, 100), false);
  d.press(250, 104, 102); assert.equal(d.lift(320, 104, 102), true);
});
test('a single tap never fires, and the sequence resets after a double-tap', () => {
  const d = new DoubleTapDetector();
  d.press(0, 0, 0); assert.equal(d.lift(60, 0, 0), false);
  d.press(100, 0, 0); assert.equal(d.lift(150, 0, 0), true);
  d.press(200, 0, 0); assert.equal(d.lift(250, 0, 0), false);
});
test('second tap too late or too far does not count (and becomes the new first tap)', () => {
  const d = new DoubleTapDetector();
  d.press(0, 0, 0); d.lift(50, 0, 0);
  d.press(700, 0, 0); assert.equal(d.lift(750, 0, 0), false);
  d.press(800, 0, 0); assert.equal(d.lift(850, 0, 0), true);
  const e = new DoubleTapDetector();
  e.press(0, 0, 0); e.lift(50, 0, 0);
  e.press(150, 200, 0); assert.equal(e.lift(200, 200, 0), false);
});
test('a long press or a drag is not a tap', () => {
  const d = new DoubleTapDetector();
  d.press(0, 0, 0); assert.equal(d.lift(900, 0, 0), false);
  d.press(1000, 0, 0); d.move(50, 0); assert.equal(d.lift(1060, 50, 0), false);
  d.press(1100, 0, 0); assert.equal(d.lift(1150, 0, 0), false); // first tap again, nothing before it
});
test('cancel (second finger / pointercancel) clears a pending first tap', () => {
  const d = new DoubleTapDetector();
  d.press(0, 0, 0); d.lift(50, 0, 0); d.cancel();
  d.press(100, 0, 0); assert.equal(d.lift(150, 0, 0), false);
});
