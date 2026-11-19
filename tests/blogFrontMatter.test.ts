import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontMatter, parseMeta } from '@/lib/blog/frontMatter';

const GOOD = { title: 'A title', description: 'A description.', date: '2026-11-19', category: 'using-anglemotion' };

test('splitFrontMatter: flat key/value block, quotes stripped, body trimmed', () => {
  const p = splitFrontMatter('---\ntitle: "Hello: world"\ndraft: false\n# comment\n---\n\nBody here.\n')!;
  assert.deepEqual(p.data, { title: 'Hello: world', draft: 'false' });
  assert.equal(p.body, 'Body here.');
});

test('splitFrontMatter: no block means null; CRLF files work', () => {
  assert.equal(splitFrontMatter('Just text'), null);
  assert.equal(splitFrontMatter('---\r\ntitle: x\r\n---\r\nBody')!.data.title, 'x');
});

test('parseMeta: valid post, defaults (author, draft false)', () => {
  const m = parseMeta('my-post', GOOD);
  assert.equal(m.author, 'Vin Baccelli');
  assert.equal(m.draft, false);
  assert.equal(m.updated, undefined);
});

test('parseMeta rejects each kind of mistake with the post name in the message', () => {
  const bad = (slug: string, over: Record<string, string>, msg: RegExp) =>
    assert.throws(() => parseMeta(slug, { ...GOOD, ...over }), (e: Error) => msg.test(e.message) && e.message.includes(slug));
  bad('Bad_Slug', {}, /file name/);
  bad('ok-slug', { title: '' }, /missing "title"/);
  bad('ok-slug', { title: 'x'.repeat(71) }, /title is 71/);
  bad('ok-slug', { description: 'x'.repeat(161) }, /description is 161/);
  bad('ok-slug', { date: '19/11/2026' }, /date must be/);
  bad('ok-slug', { date: '2026-13-45' }, /date must be/);
  bad('ok-slug', { updated: 'soon' }, /updated must be/);
  bad('ok-slug', { category: 'misc' }, /unknown category/);
  bad('ok-slug', { image: 'javascript:alert(1)' }, /image must be/);
  bad('ok-slug', { image: '//evil.example/x.png' }, /image must be/);
  bad('ok-slug', { draft: 'maybe' }, /draft must be/);
});

test('parseMeta accepts a site image path, an https image and draft: true', () => {
  assert.equal(parseMeta('p', { ...GOOD, image: '/blog/x.png' }).image, '/blog/x.png');
  assert.equal(parseMeta('p', { ...GOOD, image: 'https://example.com/x.png' }).image, 'https://example.com/x.png');
  assert.equal(parseMeta('p', { ...GOOD, draft: 'true' }).draft, true);
});
