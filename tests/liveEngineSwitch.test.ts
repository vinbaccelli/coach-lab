import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyUrlSwitches, liveEngineSwitch, LIVE_ENGINE_KEY, modeLabel } from '../lib/skeletonSwitches';

function fakeWindow(search: string, store: Record<string, string> = {}) {
  (globalThis as unknown as { window: unknown }).window = {
    location: { search },
    localStorage: { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
  };
  return store;
}
beforeEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

test('live engine experiment is OFF by default and without a window', () => {
  assert.equal(liveEngineSwitch(), null);
  fakeWindow('?debug=1');
  assert.equal(liveEngineSwitch(), null);
  assert.doesNotMatch(modeLabel(false), /LIVE ENGINE/);
});

test('?live=rtmpose-t / -s persists, ?live=off clears, anything else is ignored', () => {
  const st = fakeWindow('?live=rtmpose-s');
  assert.equal(liveEngineSwitch(), 'rtmpose-s');
  assert.equal(st[LIVE_ENGINE_KEY], 'rtmpose-s');
  assert.match(modeLabel(false), /LIVE ENGINE rtmpose-s \(experiment\)/);
  fakeWindow('?live=rtmpose-t', st);
  assert.equal(liveEngineSwitch(), 'rtmpose-t');
  fakeWindow('?live=bogus', st);
  assert.equal(liveEngineSwitch(), 'rtmpose-t', 'unknown values change nothing');
  fakeWindow('?live=off', st);
  assert.equal(liveEngineSwitch(), null);
  assert.equal(LIVE_ENGINE_KEY in st, false);
  applyUrlSwitches();
});
