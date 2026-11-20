import test from 'node:test';
import assert from 'node:assert/strict';
import { railOverlayWidth } from '../lib/timelineView';

test('collapsed phone toolbar is the 60 px rail', () => {
  assert.equal(railOverlayWidth(false, 60, 196), 60);
});
test('expanded phone toolbar opens at its own width, not the rail width (labels were cut off)', () => {
  assert.equal(railOverlayWidth(true, 60, 196), 196);
});
test('never narrower than the rail', () => {
  assert.equal(railOverlayWidth(true, 240, 196), 240);
});
