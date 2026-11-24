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

test('RTMPose-t is the default live engine; without a window (SSR) it is null', () => {
  assert.equal(liveEngineSwitch(), null);
  fakeWindow('?debug=1');
  assert.equal(liveEngineSwitch(), 'rtmpose-t');
  assert.match(modeLabel(false), /LIVE ENGINE rtmpose-t/);
});

test('?live=rtmpose-s persists, ?live=off persists an opt-out to MoveNet, ?live=default clears, anything else is ignored', () => {
  const st = fakeWindow('?live=rtmpose-s');
  assert.equal(liveEngineSwitch(), 'rtmpose-s');
  assert.equal(st[LIVE_ENGINE_KEY], 'rtmpose-s');
  assert.match(modeLabel(false), /LIVE ENGINE rtmpose-s/);
  fakeWindow('?live=bogus', st);
  assert.equal(liveEngineSwitch(), 'rtmpose-s', 'unknown values change nothing');
  fakeWindow('?live=off', st);
  assert.equal(liveEngineSwitch(), null);
  assert.equal(st[LIVE_ENGINE_KEY], 'off');
  assert.doesNotMatch(modeLabel(false), /LIVE ENGINE/);
  fakeWindow('?debug=1', st);
  assert.equal(liveEngineSwitch(), null, 'the opt-out persists across visits');
  fakeWindow('?live=default', st);
  assert.equal(liveEngineSwitch(), 'rtmpose-t');
  assert.equal(LIVE_ENGINE_KEY in st, false);
  applyUrlSwitches();
});
