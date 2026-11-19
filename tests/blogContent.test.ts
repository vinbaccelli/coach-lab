import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPostsFromDir, getPublishedPosts, BLOG_DIR } from '@/lib/blog/posts.server';
import { plainText } from '@/lib/blog/markdown';
import { AUTHORS } from '@/lib/blog/authors';

function tmp(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  for (const [n, c] of Object.entries(files)) writeFileSync(path.join(dir, n), c);
  return dir;
}
const post = (extra = '') => `---\ntitle: T\ndescription: D\ndate: 2026-11-19\ncategory: articles\n${extra}---\nBody words here.\n`;

test('loader: sorts newest first, hides drafts, computes reading time', () => {
  const dir = tmp({
    'old.md': post().replace('2026-11-19', '2026-01-01'),
    'new.md': post(),
    'secret.md': post('draft: true\n'),
  });
  try {
    // Newest first; equal dates fall back to slug order, so `new` precedes `secret`.
    assert.deepEqual(loadPostsFromDir(dir).map((p) => p.slug), ['new', 'secret', 'old']);
    assert.deepEqual(getPublishedPosts(dir).map((p) => p.slug), ['new', 'old']);
    assert.equal(loadPostsFromDir(dir)[0].readingMinutes, 1);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loader: a post with a mistake fails loudly (never silently disappears)', () => {
  const dir = tmp({ 'broken.md': '---\ntitle: T\n---\nBody' });
  try {
    assert.throws(() => loadPostsFromDir(dir), /broken.*missing "description"/);
  } finally {
    rmSync(dir, { recursive: true });
  }
  const dir2 = tmp({ 'nofm.md': 'No front matter at all' });
  try {
    assert.throws(() => loadPostsFromDir(dir2), /missing front matter/);
  } finally {
    rmSync(dir2, { recursive: true });
  }
});

test('loader: a missing folder is an empty blog, not a crash', () => {
  assert.deepEqual(loadPostsFromDir(path.join(tmpdir(), 'does-not-exist-xyz')), []);
});

test('REAL CONTENT: every article in content/blog is valid, unique, honest and safe', () => {
  const posts = loadPostsFromDir(BLOG_DIR);
  assert.ok(posts.length >= 1, 'there is at least one article');
  assert.equal(new Set(posts.map((p) => p.slug)).size, posts.length);
  for (const p of posts) {
    assert.ok(AUTHORS[p.author], `${p.slug}: author "${p.author}" needs an entry in lib/blog/authors.ts`);
    const text = plainText(p.blocks);
    assert.ok(text.split(/\s+/).length >= 150, `${p.slug}: too thin to publish`);
    assert.ok(!/stromotion/i.test(text), `${p.slug}: use "Motion Layer", never the internal name StroMotion`);
    assert.ok(!/detects? (your )?mistakes|tells you what('s| is) wrong/i.test(text), `${p.slug}: AI must not be described as finding mistakes`);
    assert.ok(!/\bguarantee/i.test(text), `${p.slug}: no guarantees`);
    assert.ok(!/<(script|iframe|style)/i.test(text), `${p.slug}: no raw HTML`);
  }
});
