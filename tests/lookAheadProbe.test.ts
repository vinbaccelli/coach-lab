import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyUrlSwitches, lookAheadOnSwitch, lookAheadDecodeOnly, lookAheadLeadOverride, modeLabel, LOOKAHEAD_ON_KEY, LOOKAHEAD_LEAD_KEY } from '../lib/skeletonSwitches';
import { AheadBuffer, sampleHiddenNow, coverageDegraded, lookAheadDisabled, needsPlay } from '../lib/lookAheadPose';

function fakeWindow(search: string, store: Record<string, string> = {}) {
  (globalThis as unknown as { window: unknown }).window = {
    location: { search },
    localStorage: { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
  };
  return store;
}
beforeEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

test('?lookahead=decode turns the probe on (decode-only), ?lookahead=1 is the full look-ahead, ?lookahead=0 off', () => {
  const st = fakeWindow('?lookahead=decode');
  assert.equal(lookAheadOnSwitch(), true);
  assert.equal(lookAheadDecodeOnly(), true);
  assert.equal(lookAheadDisabled(), false);
  assert.match(modeLabel(true), /look-ahead ON \(experimental\) · DECODE-ONLY probe/);
  fakeWindow('?lookahead=1', st);
  assert.equal(lookAheadDecodeOnly(), false);
  assert.equal(lookAheadOnSwitch(), true);
  fakeWindow('?lookahead=0', st);
  assert.equal(lookAheadOnSwitch(), false);
  assert.equal(LOOKAHEAD_ON_KEY in st, false);
});

test('?la_lead= accepts 0.04–3 s, anything else (or auto) clears the override', () => {
  const st = fakeWindow('?la_lead=2.5');
  assert.equal(lookAheadLeadOverride(), 2.5);
  assert.match(modeLabel(true), /lead 2\.5/);
  fakeWindow('?la_lead=9', st); assert.equal(lookAheadLeadOverride(), null);
  fakeWindow('?la_lead=1', st); assert.equal(lookAheadLeadOverride(), 1);
  fakeWindow('?la_lead=auto', st); assert.equal(lookAheadLeadOverride(), null);
  assert.equal(LOOKAHEAD_LEAD_KEY in st, false);
  applyUrlSwitches();
});

test('AheadBuffer.lastTime is the newest buffered time (null when empty)', () => {
  const b = new AheadBuffer();
  assert.equal(b.lastTime, null);
  const kp = [{ name: 'a', x: 1, y: 1, score: 1 }];
  b.push(2, kp); b.push(1, kp); b.push(3.5, kp);
  assert.equal(b.lastTime, 3.5);
  b.clear();
  assert.equal(b.lastTime, null);
});

test('warm-up gap: alternate main/hidden detections until the playhead reaches the first hidden frame, then hidden only', () => {
  const gapUntil = 3;
  const picks = [0, 1, 2, 3].map((tick) => sampleHiddenNow(tick, 1, gapUntil));
  assert.deepEqual(picks, [false, true, false, true]);
  for (let tick = 0; tick < 6; tick++) assert.equal(sampleHiddenNow(tick, 2.96, gapUntil), true, 'within 50 ms of the gap end');
  assert.equal(sampleHiddenNow(0, 5, gapUntil), true);
});

test('degradation: only declared once enough draws were seen and fewer than half found a result', () => {
  assert.equal(coverageDegraded(1, 10), false, 'too few draws to judge');
  assert.equal(coverageDegraded(50, 100), false);
  assert.equal(coverageDegraded(49, 100), true);
  assert.equal(coverageDegraded(0, 59), false);
});

test('tail of the clip: the last `lead` seconds use the main video only (the hidden video is pinned at the end)', () => {
  for (let tick = 0; tick < 4; tick++) assert.equal(sampleHiddenNow(tick, 13, 2.5, 12.45), false);
  assert.equal(sampleHiddenNow(0, 10, 2.5, 12.45), true);
});

test('hidden video: play() whenever it is paused and not ended, regardless of readyState (iOS stays at 0 until play())', () => {
  assert.equal(needsPlay({ paused: true, ended: false }), true);
  assert.equal(needsPlay({ paused: false, ended: false }), false);
  assert.equal(needsPlay({ paused: true, ended: true }), false, 'an ended video would restart from 0');
});
