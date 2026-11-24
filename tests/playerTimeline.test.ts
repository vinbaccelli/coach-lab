import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, validateNewItem, youtubeEmbedUrl } from '../lib/players/timeline';

test('merges notes, pictures, videos, reports and metrics newest first', () => {
  const t = buildTimeline({
    items: [
      { id: 'a', kind: 'note', body: 'good serve', media_url: null, youtube_id: null, created_at: '2026-03-02T10:00:00Z' },
      { id: 'b', kind: 'video', body: '', media_url: null, youtube_id: 'dQw4w9WgXcQ', created_at: '2026-03-04T10:00:00Z' },
      { id: 'c', kind: 'picture', body: '', media_url: 'https://x/y.jpg', created_at: '2026-03-01T10:00:00Z', youtube_id: null },
    ],
    entries: [{ id: 'e', category: 'match', folder_label: 'vs Ana', body_text: 'x', created_at: '2026-03-03T10:00:00Z' }],
    metrics: [{ id: 'm', name: 'Weight', unit: 'kg', value: 70, recorded_on: '2026-03-05' }],
  });
  assert.deepEqual(t.map((x) => x.kind), ['metric', 'video', 'report', 'note', 'picture']);
  assert.equal(t[0].title, 'Weight: 70 kg');
  assert.equal(t[1].youtubeId, 'dQw4w9WgXcQ');
  assert.equal(t[4].imageUrl, 'https://x/y.jpg');
  assert.equal(t[3].deletableId, 'a');
  assert.equal(t[2].deletableId, undefined);
});

test('comment validation', () => {
  assert.equal(validateNewItem({ kind: 'note', body: '  ' }).ok, false);
  assert.equal(validateNewItem({ kind: 'note', body: 'x'.repeat(4001) }).ok, false);
  const ok = validateNewItem({ kind: 'note', body: ' hi ' });
  assert.ok(ok.ok && ok.item.kind === 'note' && ok.item.body === 'hi');
});

test('video validation extracts the id and rejects non-YouTube links', () => {
  const ok = validateNewItem({ kind: 'video', youtube_url: 'https://youtu.be/dQw4w9WgXcQ', body: 'serve' });
  assert.ok(ok.ok && ok.item.kind === 'video' && ok.item.youtube_id === 'dQw4w9WgXcQ');
  assert.equal(validateNewItem({ kind: 'video', youtube_url: 'https://example.com/a' }).ok, false);
  assert.equal(validateNewItem({ kind: 'bogus' }).ok, false);
});

test('embed url uses the no-cookie domain', () => {
  assert.equal(youtubeEmbedUrl('dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});
