import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedTabIds } from '../lib/players/shareTabs';

test('a link shows every section it may see, even before anything is added', () => {
  assert.deepEqual(sharedTabIds(undefined), ['overview', 'timeline', 'technical', 'progress', 'biometrics', 'fitness']);
  assert.deepEqual(
    sharedTabIds({ timeline: true, technical: true, progress: true, biometrics: true, fitness: true, nutrition: true }),
    ['overview', 'timeline', 'technical', 'progress', 'biometrics', 'fitness', 'nutrition'],
  );
});

test('a section the link may not see has no tab', () => {
  assert.deepEqual(sharedTabIds({ technical: false, fitness: false, nutrition: false }), ['overview', 'timeline', 'progress', 'biometrics']);
});
