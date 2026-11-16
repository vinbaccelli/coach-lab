import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_TABS, isProfileTab } from '../components/players/ProfileTabs';

test('the Timeline tab is the second tab (visible on a phone without swiping the tab row)', () => {
  assert.deepEqual(PROFILE_TABS.slice(0, 2).map((t) => t.id), ['overview', 'timeline']);
  assert.ok(isProfileTab('timeline') && isProfileTab('nutrition') && !isProfileTab('nope'));
  assert.equal(new Set(PROFILE_TABS.map((t) => t.id)).size, PROFILE_TABS.length, 'no duplicate tabs');
});

import { visibleTabs } from '../components/players/ProfileTabs';

test('the client link shows only its tabs, in the profile order', () => {
  assert.equal(visibleTabs().length, PROFILE_TABS.length);
  assert.deepEqual(visibleTabs(['nutrition', 'overview', 'timeline']).map((t) => t.id), ['overview', 'timeline', 'nutrition']);
  assert.deepEqual(visibleTabs([]).map((t) => t.id), []);
});
