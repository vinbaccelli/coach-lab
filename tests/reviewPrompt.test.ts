import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_PROMPT_INTERVAL_MS as MONTH, isReviewPromptPath, parseReviewPromptState, shouldShowReviewPrompt } from '../lib/reviewPrompt';

const NOW = 1_800_000_000_000;

test('shown right after the first sign-in (no state yet)', () => {
  assert.equal(shouldShowReviewPrompt(null, NOW), true);
  assert.equal(shouldShowReviewPrompt({}, NOW), true);
});

test('after "Not now" it comes back once a month, not before', () => {
  assert.equal(shouldShowReviewPrompt({ lastAt: NOW - 1000 }, NOW), false);
  assert.equal(shouldShowReviewPrompt({ lastAt: NOW - MONTH + 1000 }, NOW), false);
  assert.equal(shouldShowReviewPrompt({ lastAt: NOW - MONTH }, NOW), true);
});

test('once the user opened Trustpilot it never comes back', () => {
  assert.equal(shouldShowReviewPrompt({ lastAt: NOW - 10 * MONTH, done: true }, NOW), false);
});

test('bad stored values are ignored, not trusted', () => {
  assert.equal(parseReviewPromptState('not json'), null);
  assert.equal(parseReviewPromptState('{"lastAt":"x","done":"yes"}')?.done, undefined);
  assert.deepEqual(parseReviewPromptState('{"lastAt":5,"done":true}'), { lastAt: 5, done: true });
});

test('only on signed-in app pages, not on public pages or the sign-in flow', () => {
  for (const p of ['/analysis', '/players', '/players/abc', '/dashboard', '/billing']) assert.equal(isReviewPromptPath(p), true, p);
  for (const p of ['/', '/login', '/auth/callback', '/share/abc', '/privacy', '/terms', '/pricing', '/r/xyz', '/coach/vin', '/coaches']) assert.equal(isReviewPromptPath(p), false, p);
});
