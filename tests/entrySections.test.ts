import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withSections } from '../lib/reports/entrySections';

test('decoder sections are stored in metadata with only the fields the report shows', () => {
  const out = withSections({ keep: 1 }, [
    { heading: 'Serve', headingLevel: 'h3', lines: ['a', 2, 'b'], notes: 'n', imageUrl: 'https://i/1.png', imageObjectSizePt: { width: 1, height: 2 }, junk: true },
    { headingLevel: 'h9', lines: 'nope' },
  ]);
  assert.deepEqual(out, {
    keep: 1,
    sections: [
      { heading: 'Serve', headingLevel: 'h3', lines: ['a', 'b'], notes: 'n', imageUrl: 'https://i/1.png' },
      {},
    ],
  });
});

test('no sections, or a problem with them, leaves the metadata untouched and never throws', () => {
  const md = { manualMatch: { version: 2 } };
  assert.equal(withSections(md, undefined), md);
  assert.equal(withSections(md, []), md);
  assert.equal(withSections(md, 'not an array' as never), md);
  const tooBig = [{ notes: 'x'.repeat(500_000) }];
  assert.equal(withSections(md, tooBig), md);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.doesNotThrow(() => withSections(md, [{ lines: [circular as never] }, { get heading(): string { throw new Error('boom'); } } as never]));
  assert.equal(withSections(md, [{ get heading(): string { throw new Error('boom'); } } as never]), md);
});

test('the entries route skips the Google Doc write only behind REPORTS_IN_APP, and always stores sections', () => {
  const src = readFileSync('app/api/players/[id]/entries/route.ts', 'utf8');
  assert.match(src, /body\.category === 'match' && !REPORTS_IN_APP/);
  assert.match(src, /metadata: withSections\(body\.metadata \?\? \{\}, body\.sections\)/);
  // The Doc path (and its missing-token message) is still there as the backup.
  assert.match(src, /Google access not granted — sign out and sign in again to enable Docs export/);
  assert.match(src, /ensurePlayerDoc/);
});
