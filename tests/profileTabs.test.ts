import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE_TAB, PROFILE_TABS, isProfileTab } from '../components/players/ProfileTabs';

test('the Timeline tab is the first tab and the profile opens on it', () => {
  assert.deepEqual(PROFILE_TABS.slice(0, 2).map((t) => t.id), ['timeline', 'overview']);
  assert.equal(DEFAULT_PROFILE_TAB, 'timeline');
  assert.ok(isProfileTab('timeline') && isProfileTab('nutrition') && !isProfileTab('nope'));
  assert.equal(new Set(PROFILE_TABS.map((t) => t.id)).size, PROFILE_TABS.length, 'no duplicate tabs');
});

import { visibleTabs } from '../components/players/ProfileTabs';

test('the client link shows only its tabs, in the profile order', () => {
  assert.equal(visibleTabs().length, PROFILE_TABS.length);
  assert.deepEqual(visibleTabs(['nutrition', 'overview', 'timeline']).map((t) => t.id), ['timeline', 'overview', 'nutrition']);
  assert.deepEqual(visibleTabs([]).map((t) => t.id), []);
});
