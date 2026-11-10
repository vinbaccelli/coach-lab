import test from 'node:test';
import assert from 'node:assert/strict';
import { playerLimit, LIGHT_PLAYER_LIMIT } from '../lib/players/limits';

test('Light is limited to one player', () => {
  assert.equal(playerLimit({ plan: 'light', admin: false, trial: false }), LIGHT_PLAYER_LIMIT);
  assert.equal(LIGHT_PLAYER_LIMIT, 1);
});

test('Pro, Academy, trial and admin are not limited', () => {
  assert.equal(playerLimit({ plan: 'pro', admin: false, trial: false }), Infinity);
  assert.equal(playerLimit({ plan: 'academy', admin: false, trial: false }), Infinity);
  assert.equal(playerLimit({ plan: null, admin: false, trial: true }), Infinity);
  assert.equal(playerLimit({ plan: 'light', admin: true, trial: false }), Infinity);
});
