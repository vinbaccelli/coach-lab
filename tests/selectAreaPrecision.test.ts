import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the Motion Layer "Select Area" bug: a latched precision-draw mode took the finger as a crosshair
// anchor (the anchor branch is routed before the rubber-band branch), so the drag drew no box and ended in
// "Selection cancelled". Reproduced in the phone-emulated browser; the browser flow is not unit-testable.
const src = readFileSync(new URL('../components/Canvas.tsx', import.meta.url), 'utf8');

test('precision anchor acquisition is skipped while a StroMotion region selection is armed', () => {
  const i = src.indexOf('const precisionTouchEligible =');
  assert.ok(i > 0, 'precisionTouchEligible not found');
  const block = src.slice(i, i + 300);
  assert.match(block, /precisionTouchDrawRef\.current\s*&&\s*!isSelectingStroRegionRef\.current/);
});

test('the rubber-band branch still comes after the precision anchor branch (so the gate above is what protects it)', () => {
  const anchor = src.indexOf('if (precisionTouchEligible && precisionAnchorPointerIdRef.current === null)');
  const region = src.indexOf('// ── StroMotion rubber-band region selection ──────────────────────────\n      if (isSelectingStroRegionRef.current) {');
  assert.ok(anchor > 0 && region > anchor, 'ordering assumption changed: re-check the gate');
});
