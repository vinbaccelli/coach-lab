import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyUrlSwitches, legacyOn, lookAheadOnSwitch, modeLabel, LEGACY_KEY, LOOKAHEAD_ON_KEY } from '../lib/skeletonSwitches';
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
  assert.equal(lookAheadOnSwitch(), false);
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

test('look-ahead is OFF by default; ?lookahead=1 turns it on, ?lookahead=0 off again', () => {
  const st = fakeWindow('?debug=1');
  assert.equal(lookAheadDisabled(), true, 'default OFF (an iPhone test showed it can stall the main video)');
  fakeWindow('?lookahead=1', st);
  assert.equal(lookAheadOnSwitch(), true);
  assert.equal(st[LOOKAHEAD_ON_KEY], '1');
  assert.equal(lookAheadDisabled(), false);
  fakeWindow('?lookahead=0', st);
  assert.equal(lookAheadOnSwitch(), false);
  assert.equal(st[LOOKAHEAD_ON_KEY], undefined);
  assert.equal(lookAheadDisabled(), true);
});

test('a link without switches keeps whatever was set before (sticky)', () => {
  const st = fakeWindow('?legacy=1');
  legacyOn();
  fakeWindow('?debug=1', st);
  assert.equal(legacyOn(), true);
});

test('legacy implies look-ahead disabled even if switched on; mode label says which mode ran', () => {
  fakeWindow('?legacy=1&lookahead=1');
  assert.equal(lookAheadDisabled(), true);
  assert.match(modeLabel(false), /LEGACY/);
  fakeWindow('?legacy=0&lookahead=1');
  assert.match(modeLabel(true), /NEW · LIVE ENGINE rtmpose-t · look-ahead ON \(experimental\)/);
  assert.match(modeLabel(false), /look-ahead OFF \(default\)/);
  applyUrlSwitches();
});
