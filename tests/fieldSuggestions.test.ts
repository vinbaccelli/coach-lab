import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionsFor, SUGGESTED_FIELD_LABELS } from '../lib/players/fieldSuggestions';

test('all suggestions are offered on an empty sheet', () => {
  assert.deepEqual(suggestionsFor([]), [...SUGGESTED_FIELD_LABELS]);
});

test('a field already on the sheet is not suggested again (case and spaces ignored)', () => {
  const out = suggestionsFor(['  nutrition PLAN ', 'Height']);
  assert.ok(!out.includes('Nutrition plan'));
  assert.equal(out.length, SUGGESTED_FIELD_LABELS.length - 1);
});
