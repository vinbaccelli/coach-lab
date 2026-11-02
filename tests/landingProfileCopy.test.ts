import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const landing = readFileSync('components/LandingPage.tsx', 'utf8');

test('landing: the player profile page is described, and the old Google Doc flow is not the main way', () => {
  assert.ok(landing.includes('Every player gets a profile page in AngleMotion'));
  assert.ok(landing.includes('a profile page for every player with their notes, screenshots and reports'));
  assert.ok(landing.includes('your screenshots in your own Google Drive; the report text is kept in AngleMotion'));
  for (const stale of ['which is a Google Doc', 'your reports in your Google Drive', 'per-player Google Docs', 'Every player carries two documents', 'drop everything into the player’s document', 'Two files that outlive']) {
    assert.equal(landing.includes(stale), false, stale);
  }
});

test('landing: no claim of a share link or PDF export (not merged), and no Pro-only player database', () => {
  assert.equal(/share link|public report|PDF/i.test(landing), false);
  assert.equal(/shareable record/i.test(landing), false);
  assert.ok(landing.includes('Every plan has the player database.'));
  assert.equal(/player database[^.]{0,40}(Pro only|only on Pro|Pro and Academy only)/i.test(landing), false);
});

test('landing: the two images that still show the old Docs buttons carry a retake note', () => {
  assert.equal((landing.match(/TODO retake after profile merge/g) ?? []).length, 2);
});

test('landing: no hype words', () => {
  assert.equal(/\bunlock|next level|game-changing/i.test(landing), false);
});
