import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_BUTTON_GAP_PX, reportButtonBottomPx } from '@/lib/reportButtonPlacement';

test('the button sits just above the zoom stack on a 390×844 phone', () => {
  // Stack: 36 px buttons, 6 px gaps, help + / − / ⌂ = 4 buttons → 162 px tall, 12 px from the right,
  // bottom edge 92 px above the screen bottom → top edge at 844 − 92 − 162 = 590.
  const top = 844 - 92 - 162;
  assert.equal(reportButtonBottomPx(844, { top, width: 36, height: 162 }), 844 - top + REPORT_BUTTON_GAP_PX);
  assert.equal(reportButtonBottomPx(844, { top, width: 36, height: 162 }), 262);
  // Without the help button the stack is shorter, the button comes down with it.
  const top3 = 844 - 92 - 120;
  assert.equal(reportButtonBottomPx(844, { top: top3, width: 36, height: 120 }), 220);
});

test('no stack, or a hidden one, gives no measured position (the CSS fallback applies)', () => {
  assert.equal(reportButtonBottomPx(844, null), null);
  assert.equal(reportButtonBottomPx(844, { top: 600, width: 0, height: 120 }), null);
  assert.equal(reportButtonBottomPx(844, { top: 600, width: 36, height: 0 }), null);
  assert.equal(reportButtonBottomPx(844, { top: NaN, width: 36, height: 120 }), null);
  assert.equal(reportButtonBottomPx(0, { top: 600, width: 36, height: 120 }), null);
});

test('a stack scrolled below the screen never pushes the button off it', () => {
  assert.equal(reportButtonBottomPx(844, { top: 900, width: 36, height: 120 }), REPORT_BUTTON_GAP_PX);
});
