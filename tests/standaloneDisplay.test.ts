import test from 'node:test';
import assert from 'node:assert/strict';
import { isStandaloneDisplay } from '../lib/standaloneDisplay';

test('an installed app (display-mode standalone, or iOS navigator.standalone) is standalone', () => {
  assert.equal(isStandaloneDisplay({ matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }), true);
  assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
});

test('a normal browser tab is not, and missing APIs never throw', () => {
  assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: { standalone: false } }), false);
  assert.equal(isStandaloneDisplay({}), false);
  assert.equal(isStandaloneDisplay(undefined), false);
  assert.equal(isStandaloneDisplay({ matchMedia: () => { throw new Error('x'); } }), false);
});
