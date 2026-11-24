import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultMeasurementName, plusAction } from '../lib/columnPrompt';

test('default names are the ones the old modal offered', () => {
  assert.equal(defaultMeasurementName('angle'), 'Angle');
  assert.equal(defaultMeasurementName('arrowAngle'), 'Arrow angle');
  assert.equal(defaultMeasurementName('line'), 'Distance');
  assert.equal(defaultMeasurementName('ruler'), 'Distance');
});

test('the column "+" asks about the last drawing when one is waiting, else it opens the manual note as before', () => {
  assert.equal(plusAction({ type: 'angle', value: 42, unit: '°' }), 'ask-last-drawing');
  assert.equal(plusAction(null), 'manual-note');
});

// The page wiring is not unit-testable (a 9k-line component); guard the two decisions that matter.
const page = readFileSync(new URL('../app/analysis/page.tsx', import.meta.url), 'utf8');

test('a drawing no longer opens the naming modal by itself: it only remembers the measurement', () => {
  const i = page.indexOf('onMeasurementCommit={(m) => {');
  assert.ok(i > 0);
  const handler = page.slice(i, i + 2500);
  assert.match(handler, /if \(dataColumnVisible\) setLastMeasurement\(m\);/);
  assert.doesNotMatch(handler, /setPendingMeasurement\(m\)/, 'the per-drawing popup must be gone');
});

test('both "+" buttons ask about the last drawing first, and the ruler no longer pops the modal either', () => {
  assert.equal(page.split('if (askAboutLastDrawing()) return;').length - 1, 2, 'canvas onMeasurementAdd and the HTML + button');
  assert.match(page, /if \(dataColumnActive\) setLastMeasurement\(\{ type: 'ruler', value, unit \}\);/);
});
