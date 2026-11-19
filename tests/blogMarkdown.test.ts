import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, safeHref, plainText } from '@/lib/blog/markdown';

test('headings: # and ## become H2 (the page owns the H1); ### H3; #### H4', () => {
  const b = parseMarkdown('# One\n\n## Two\n\n### Three\n\n#### Four');
  assert.deepEqual(b.map((x) => x.t === 'h' && x.level), [2, 2, 3, 4]);
});

test('paragraphs join wrapped lines; blank line separates', () => {
  const b = parseMarkdown('first line\nsecond line\n\nnext');
  assert.equal(b.length, 2);
  assert.equal(plainText([b[0]]), 'first line second line');
});

test('bullet and numbered lists, with indented continuation lines', () => {
  const b = parseMarkdown('- a\n- b\n  more b\n\n1. x\n2. y');
  assert.equal(b[0].t, 'ul');
  assert.equal(b[0].t === 'ul' && b[0].items.length, 2);
  assert.equal(b[0].t === 'ul' && plainText([{ t: 'p', c: b[0].items[1] }]), 'b more b');
  assert.equal(b[1].t, 'ol');
});

test('blockquote, hr, fenced code (content is not parsed as markdown)', () => {
  const b = parseMarkdown('> quoted **bold**\n\n---\n\n```js\nconst a = **not bold**;\n```');
  assert.deepEqual(b.map((x) => x.t), ['quote', 'hr', 'code']);
  const code = b[2];
  assert.equal(code.t === 'code' && code.v, 'const a = **not bold**;');
});

test('inline: bold, italic, code, link, image, and a link inside bold', () => {
  const n = parseInline('a **b** *c* `d` [e](/x) ![f](/img.png) **see [g](/y)**');
  const kinds = n.map((x) => x.t);
  for (const k of ['strong', 'em', 'code', 'link', 'img']) assert.ok(kinds.includes(k as never), k);
  const link = n.find((x) => x.t === 'link');
  assert.equal(link && link.t === 'link' && link.href, '/x');
  const strongs = n.filter((x) => x.t === 'strong');
  assert.equal(strongs.length, 2);
  assert.ok(JSON.stringify(strongs[1]).includes('"href":"/y"'), 'a link nests inside bold');
});

test('known limit: triple-star emphasis renders as bold with stray asterisks (safe), and URLs with one level of parentheses work', () => {
  assert.equal(plainText(parseMarkdown('x ***y*** z')), 'x *y* z');
  const l = parseInline('[w](https://en.wikipedia.org/wiki/Tennis_(sport))');
  assert.deepEqual(l.map((x) => x.t), ['link']);
  assert.equal(l[0].t === 'link' && l[0].href, 'https://en.wikipedia.org/wiki/Tennis_(sport)');
});

test('SECURITY: unsafe link and image targets are dropped to plain text', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example', 'http://insecure.example', 'vbscript:x']) {
    const link = parseInline(`[click](${bad})`);
    assert.deepEqual(link, [{ t: 'text', v: 'click' }], bad);
    const img = parseInline(`![alt](${bad})`);
    assert.ok(img.every((x) => x.t !== 'img'), bad);
  }
  assert.equal(safeHref('/blog/x'), '/blog/x');
  assert.equal(safeHref('https://a.example/b'), 'https://a.example/b');
  assert.equal(safeHref('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(safeHref('#section'), '#section');
});

test('SECURITY: raw HTML in a post stays literal text; there is no HTML node type', () => {
  const b = parseMarkdown('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  assert.equal(b.length, 1);
  assert.equal(plainText(b), '<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  assert.ok(JSON.stringify(b).includes('"t":"text"'));
  assert.ok(!/"t":"html"/.test(JSON.stringify(b)));
});

test('underscores inside words and snake_case stay literal', () => {
  assert.equal(plainText(parseMarkdown('use snake_case_name and 2*3*4')), 'use snake_case_name and 2*3*4');
});

test('empty and whitespace input give no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('\n  \n'), []);
});
