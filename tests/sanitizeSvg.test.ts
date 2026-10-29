import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg } from '../components/reports/sanitizeSvg';
import { divergingBarChart, donutChart, hBarChart, statTiles } from '../lib/matchAnalysis/svgCharts';

const clean = (s: string) => sanitizeSvg(s) as string;

test('the chart generator\'s own output passes through unchanged in meaning', () => {
  const svg = statTiles({ title: 'Headline indices — José', tiles: [{ label: 'Points won', value: '12', formula: 'of 24' }, { label: 'Winners', value: '4' }] });
  const out = clean(svg);
  assert.ok(out.startsWith('<svg'));
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(out.includes('viewBox="0 0 '));
  assert.equal((out.match(/<text/g) ?? []).length, (svg.match(/<text/g) ?? []).length, 'every label kept');
  assert.equal((out.match(/<rect/g) ?? []).length, (svg.match(/<rect/g) ?? []).length);
  assert.ok(out.includes('&#233;'), 'encoded characters survive');
  assert.deepEqual(clean(out), out, 'sanitising is idempotent');
  const items = [{ label: 'Forehand', value: 4 }, { label: 'Backhand — slice', value: -2 }];
  for (const chart of [
    hBarChart({ title: 'Winners', items, unit: '' }),
    divergingBarChart({ title: 'Differential', items }),
    donutChart({ title: 'Share', slices: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] }),
  ]) {
    const c = clean(chart);
    for (const el of ['rect', 'circle', 'line', 'text']) {
      assert.equal((c.match(new RegExp(`<${el}[\\s>/]`, 'g')) ?? []).length, (chart.match(new RegExp(`<${el}[\\s>/]`, 'g')) ?? []).length, `${el} count`);
    }
    // Every attribute the generator wrote on a drawn element is still there.
    assert.equal((c.match(/ fill="/g) ?? []).length, (chart.match(/ fill="/g) ?? []).length);
    assert.equal((c.match(/ stroke-width="/g) ?? []).length, (chart.match(/ stroke-width="/g) ?? []).length);
    assert.equal((c.match(/ transform="/g) ?? []).length, (chart.match(/ transform="/g) ?? []).length);
  }
});

test('script elements are removed with their content', () => {
  const out = clean('<svg><script>alert(1)</script><rect width="1" height="1"/></svg>');
  assert.equal(out, '<svg><rect width="1" height="1"/></svg>');
  assert.ok(!/script|alert/i.test(clean('<svg><SCRIPT type="x">if(a<b){alert(1)}</SCRIPT><g><ScRiPt>x</ScRiPt></g></svg>')));
});

test('foreignObject (and the HTML inside it) is removed', () => {
  const out = clean('<svg><foreignObject width="9" height="9"><iframe src="https://evil"></iframe><div onclick="x()">hi</div></foreignObject><circle r="2"/></svg>');
  assert.equal(out, '<svg><circle r="2"/></svg>');
});

test('event attributes are removed, on any element, in any case or quoting', () => {
  const out = clean('<svg onload="x()" ONCLICK=y() onmouseover=\'z()\'><rect onerror="1" width="3" OnFocus="2"/><text onclick="q" x="1">a</text></svg>');
  assert.ok(!/on\w+\s*=/i.test(out), out);
  assert.ok(out.includes('width="3"') && out.includes('x="1"'));
});

test('no external or any other references: href, xlink:href, url(), use, image, a, data:, javascript:', () => {
  const dirty = [
    '<svg><image href="https://evil/x.png" width="1" height="1"/></svg>',
    '<svg><use href="#a"/><use xlink:href="https://evil/x.svg#a"/></svg>',
    '<svg><a href="javascript:alert(1)"><text x="1">x</text></a></svg>',
    '<svg><rect fill="url(https://evil/x.svg#p)" width="1"/></svg>',
    '<svg><rect fill="url(#local)" stroke="URL( #a )" width="1"/></svg>',
    '<svg><rect fill="u&#114;l(https://evil)" width="1"/></svg>',
    '<svg><rect style="fill:url(https://evil); background:url(data:text/html,x)" width="1"/></svg>',
    '<svg><text x="1" font-family="x;}@import url(//evil)">t</text></svg>',
    '<svg><rect fill="javascript:alert(1)" width="1"/></svg>',
  ];
  for (const d of dirty) {
    const out = clean(d);
    assert.ok(!/href|url\s*\(|javascript:|data:|<use|<image|<a[\s>]|@import|style=|evil/i.test(out), `${d} -> ${out}`);
  }
  // ...while a plain colour and the text inside <a> content is not smuggled out of the allowlist
  assert.equal(clean('<svg><rect fill="#1A1A1A" width="1"/></svg>'), '<svg><rect fill="#1A1A1A" width="1"/></svg>');
});

test('animation, style and unknown elements are dropped; text is re-escaped', () => {
  const out = clean('<svg><style>*{fill:red}</style><animate attributeName="href" to="javascript:x"/><set to="x"/><unknown><rect width="1"/></unknown><text x="1">a &amp; b <b>c</b> &bogus; <i onclick=x>d</i></text></svg>');
  assert.ok(!/style|animate|<set|unknown|<b>|<i/i.test(out), out);
  assert.ok(out.includes('a &amp; b'));
  assert.ok(out.includes('&amp;bogus;'), 'a made-up entity is escaped, not passed through');
  assert.ok(!/<rect/.test(out), 'children of a dropped element go with it');
});

test('comments, CDATA, doctype and processing instructions are removed', () => {
  const out = clean('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg><!-- <script>x</script> --><![CDATA[<script>x</script>]]><rect width="1"/></svg>');
  assert.equal(out, '<svg><rect width="1"/></svg>');
});

test('nested or extra <svg> roots, bad structure and truncation fail closed', () => {
  assert.equal(clean('<svg><svg onload="x"><rect width="1"/></svg><circle r="1"/></svg>'), '<svg><circle r="1"/></svg>');
  assert.equal(sanitizeSvg('<div><svg><rect width="1"/></svg></div>'), null, 'no root svg first');
  assert.equal(sanitizeSvg('<script>alert(1)</script>'), null);
  assert.equal(sanitizeSvg(''), null);
  assert.equal(sanitizeSvg(42), null);
  assert.equal(sanitizeSvg(undefined), null);
  const cut = clean('<svg><rect width="1"/><text x="1">ok</text><rect onload="x(" width="1');
  assert.ok(cut.startsWith('<svg') && cut.endsWith('</svg>') && !/onload/.test(cut), cut);
  // unclosed tags are closed
  assert.equal(clean('<svg><g><rect width="2"/>'), '<svg><g><rect width="2"/></g></svg>');
});

test('attribute values must match their pattern: anything else is dropped, not repaired', () => {
  const out = clean('<svg width="100" height="1;alert(1)" viewBox="0 0 10 10" xmlns="http://evil/ns"><rect x="javascript:1" y="5" fill="red" stroke="#abc" transform="rotate(45 1 2)" width="9"/><rect transform="rotate(1) url(#x)" width="1"/></svg>');
  assert.ok(out.includes('width="100"') && out.includes('viewBox="0 0 10 10"'));
  assert.ok(!out.includes('height="1;alert') && !out.includes('evil') && !out.includes('javascript'));
  assert.ok(out.includes('transform="rotate(45 1 2)"') && !out.includes('url('));
  assert.ok(out.includes('fill="red"') && out.includes('stroke="#abc"'));
});

test('limits: oversized input and very deep nesting are refused', () => {
  assert.equal(sanitizeSvg('<svg>' + 'x'.repeat(500_000) + '</svg>'), null);
  assert.equal(sanitizeSvg('<svg>' + '<g>'.repeat(60) + '</svg>'), null);
});
