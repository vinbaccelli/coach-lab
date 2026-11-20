import test from 'node:test';
import assert from 'node:assert/strict';
import { killedNotice, AUTODETECT_KILLED_NOTICE, AUTODETECT_KILLED_RACKET_NOTICE } from '../lib/stroMotionDraft/phoneBudget';

test('after a kill with Racket detection off the notice is the plain one', () => {
  assert.equal(killedNotice(false), AUTODETECT_KILLED_NOTICE);
});
test('after a kill with Racket detection on the notice says it was switched off', () => {
  assert.equal(killedNotice(true), AUTODETECT_KILLED_RACKET_NOTICE);
  assert.match(AUTODETECT_KILLED_RACKET_NOTICE, /switched off/i);
  assert.match(AUTODETECT_KILLED_RACKET_NOTICE, /memory/i);
});
