import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRacketEnabled } from '@/lib/stroMotionDraft/autoRacketFlags';

function withWindow(w: Record<string, unknown>, fn: () => void) {
  const g = globalThis as unknown as { window?: unknown };
  const prev = g.window;
  g.window = { localStorage: { getItem: () => null }, ...w };
  try { fn(); } finally { g.window = prev; }
}

test('desktop: racket pass stays on in the implement modes and off in player/ball', () => {
  withWindow({}, () => {
    assert.equal(autoRacketEnabled('racket'), true);
    assert.equal(autoRacketEnabled('custom'), true);
    assert.equal(autoRacketEnabled('player'), false);
    assert.equal(autoRacketEnabled('ball'), false);
  });
});

test('phone: racket pass is off by default in every mode', () => {
  withWindow({ __stroPhoneBudget: true }, () => {
    assert.equal(autoRacketEnabled('racket'), false);
    assert.equal(autoRacketEnabled('custom'), false);
    assert.equal(autoRacketEnabled('player'), false);
  });
});

test('phone: explicit opt-in still turns it on, explicit off still wins', () => {
  withWindow({ __stroPhoneBudget: true, __autoRacket: true }, () => assert.equal(autoRacketEnabled('racket'), true));
  withWindow({ __stroPhoneBudget: true, localStorage: { getItem: (k: string) => (k === 'autoRacket' ? '1' : null) } }, () => assert.equal(autoRacketEnabled('player'), true));
  withWindow({ localStorage: { getItem: (k: string) => (k === 'autoRacket' ? '0' : null) } }, () => assert.equal(autoRacketEnabled('racket'), false));
});
