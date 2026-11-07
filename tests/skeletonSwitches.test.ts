import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyUrlSwitches, legacyOn, lookAheadOffSwitch, modeLabel, LEGACY_KEY, LOOKAHEAD_OFF_KEY } from '../lib/skeletonSwitches';
import { lookAheadDisabled } from '../lib/lookAheadPose';

function fakeWindow(search: string, store: Record<string, string> = {}) {
  (globalThis as unknown as { window: unknown }).window = {
    location: { search },
    localStorage: { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
  };
  return store;
}
beforeEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

test('no window (server render / tests): everything off, nothing throws', () => {
  assert.equal(legacyOn(), false);
  assert.equal(lookAheadOffSwitch(), false);
  assert.equal(lookAheadDisabled(), true, 'look-ahead needs a browser');
});

test('?legacy=1 persists, ?legacy=0 clears', () => {
  const st = fakeWindow('?debug=1&legacy=1');
  assert.equal(legacyOn(), true);
  assert.equal(st[LEGACY_KEY], '1');
  fakeWindow('?legacy=0', st);
  assert.equal(legacyOn(), false);
  assert.equal(LEGACY_KEY in st, false);
});

test('?lookahead=0 turns only look-ahead off; ?lookahead=1 turns it back on', () => {
  const st = fakeWindow('?lookahead=0');
  assert.equal(lookAheadOffSwitch(), true);
  assert.equal(legacyOn(), false);
  assert.equal(lookAheadDisabled(), true);
  fakeWindow('?lookahead=1', st);
  assert.equal(lookAheadOffSwitch(), false);
  assert.equal(st[LOOKAHEAD_OFF_KEY], undefined);
  assert.equal(lookAheadDisabled(), false);
});

test('a link without switches keeps whatever was set before (sticky)', () => {
  const st = fakeWindow('?legacy=1');
  legacyOn();
  fakeWindow('?debug=1', st);
  assert.equal(legacyOn(), true);
});

test('legacy implies look-ahead disabled; mode label says which mode ran', () => {
  fakeWindow('?legacy=1');
  assert.equal(lookAheadDisabled(), true);
  assert.match(modeLabel(false), /LEGACY/);
  fakeWindow('?legacy=0&lookahead=1');
  assert.match(modeLabel(true), /NEW · look-ahead ON/);
  assert.match(modeLabel(false), /look-ahead OFF/);
  applyUrlSwitches();
});
