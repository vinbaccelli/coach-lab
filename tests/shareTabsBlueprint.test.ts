import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedTabIds } from '../lib/players/shareTabs';

test('the Blueprint tab follows the Technical tab when the link carries a Blueprint', () => {
  assert.deepEqual(sharedTabIds(undefined, { blueprint: true }), ['overview', 'timeline', 'technical', 'blueprint', 'progress', 'biometrics', 'fitness']);
});

test('no Blueprint tab when the link has none, or when Technical is hidden', () => {
  assert.deepEqual(sharedTabIds(undefined, { blueprint: false }), ['overview', 'timeline', 'technical', 'progress', 'biometrics', 'fitness']);
  assert.ok(!sharedTabIds({ technical: false }, { blueprint: true }).includes('blueprint'));
});
