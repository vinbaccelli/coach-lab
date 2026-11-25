import test from 'node:test';
import assert from 'node:assert/strict';

test('a report on the timeline carries its entry id so the feed can link to the report page', async () => {
  const { itemFromReport } = await import('../lib/players/history');
  const it = itemFromReport({ id: 'entry-42', category: 'match', folder_label: '2026-11-25 — Match report', body_text: null, created_at: '2026-11-25T19:00:00Z' });
  assert.equal(it.type, 'report');
  assert.equal(it.entryId, 'entry-42');
});
