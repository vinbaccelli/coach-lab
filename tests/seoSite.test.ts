import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PRIVATE_PATHS, buildRobots } from '@/lib/seo/robots';
import { buildSitemap, STATIC_PUBLIC_PATHS } from '@/lib/seo/sitemap';
import { SITE_URL, SITE_DESCRIPTION, absoluteUrl, jsonLdString } from '@/lib/seo/site';

const root = path.resolve(import.meta.dirname, '..');

/** The middleware's real public list, read from its source so this test cannot drift from it. */
function middlewarePublicPrefixes(): string[] {
  const src = readFileSync(path.join(root, 'middleware.ts'), 'utf8');
  // ONLY the public-path block (`if (pathname === '/' || ... ) { return res; }`). The file also has
  // startsWith() checks for the GATED routes further down; reading those would make /analysis look public.
  const block = /if \(\s*pathname === '\/' \|\|([\s\S]*?)\)\s*\{\s*return res;/.exec(src);
  assert.ok(block, 'middleware.ts public-path block not found: update this test if the middleware was restructured');
  return [...block[1].matchAll(/pathname\.startsWith\('([^']+)'\)/g)].map((m) => m[1]);
}
const isPublic = (p: string) => p === '/' || middlewarePublicPrefixes().some((pre) => p.startsWith(pre));

test('the middleware lets /blog and its pages through (public) while /analysis stays gated', () => {
  assert.ok(isPublic('/blog'));
  assert.ok(isPublic('/blog/how-to-analyze-a-tennis-stroke-on-video'));
  assert.ok(isPublic('/blog/category/using-anglemotion'));
  assert.ok(!isPublic('/analysis'));
  assert.ok(!isPublic('/academy'));
  assert.ok(!isPublic('/admin'));
});

test('every sitemap URL is on the canonical host and public in the middleware', () => {
  const map = buildSitemap({
    posts: [{ slug: 'a-post', date: '2026-11-19' }],
    categories: ['using-anglemotion'],
    coachSlugs: ['vinbaccelli'],
  });
  assert.ok(map.length >= STATIC_PUBLIC_PATHS.length + 3);
  for (const e of map) {
    assert.ok(e.url.startsWith(`${SITE_URL}/`) || e.url === SITE_URL, e.url);
    assert.ok(isPublic(new URL(e.url).pathname), `${e.url} must be public in middleware.ts`);
    assert.ok(!PRIVATE_PATHS.some((p) => new URL(e.url).pathname.startsWith(p)), `${e.url} is disallowed in robots`);
  }
  assert.equal(map.find((e) => e.url.endsWith('/blog/a-post'))?.lastModified, '2026-11-19');
});

test('robots: allows the site, disallows the private areas, points at the sitemap', () => {
  const r = buildRobots();
  const rule = (Array.isArray(r.rules) ? r.rules[0] : r.rules) as { allow: string; disallow: string[] };
  assert.equal(rule.allow, '/');
  assert.equal(r.sitemap, `${SITE_URL}/sitemap.xml`);
  for (const must of ['/analysis', '/academy', '/api/', '/login', '/admin', '/billing', '/share/', '/r/', '/affiliate/']) assert.ok(rule.disallow.includes(must), must);
  for (const pub of ['/', '/pricing', '/coaches', '/coach/vinbaccelli', '/blog', '/privacy', '/terms']) {
    assert.ok(!rule.disallow.some((d) => pub.startsWith(d) && d !== '/'), `${pub} must not be disallowed`);
  }
});

test('COMPLETENESS: every top-level app route that the middleware gates is disallowed in robots', () => {
  const appDir = path.join(root, 'app');
  const routes = readdirSync(appDir).filter((n) => statSync(path.join(appDir, n)).isDirectory() && !n.startsWith('(') && !n.startsWith('_'));
  const ignore = new Set(['dev']); // dev-only harnesses; public only in development
  // A route is public if the middleware lets it (or a child path, for prefixes like /coach/) through.
  const missing = routes.filter((d) => !ignore.has(d) && !isPublic(`/${d}`) && !isPublic(`/${d}/x`)).filter((d) => !PRIVATE_PATHS.some((p) => p === `/${d}` || p === `/${d}/`));
  assert.deepEqual(missing, [], `gated routes missing from PRIVATE_PATHS: ${missing.join(', ')}`);
});

test('absoluteUrl and the site description', () => {
  assert.equal(absoluteUrl('/blog'), `${SITE_URL}/blog`);
  assert.equal(absoluteUrl('blog'), `${SITE_URL}/blog`);
  assert.equal(absoluteUrl('https://example.com/x'), 'https://example.com/x');
  assert.ok(SITE_DESCRIPTION.length <= 160, `description is ${SITE_DESCRIPTION.length} chars`);
});

test('SECURITY: jsonLdString cannot close the script tag or break out', () => {
  const s = jsonLdString({ a: '</script><script>alert(1)</script>', b: 'x & y', c: ' ' });
  assert.ok(!s.includes('<'), 'no raw <');
  assert.ok(!s.includes('>'), 'no raw >');
  assert.ok(!s.includes('&'), 'no raw &');
  assert.deepEqual(JSON.parse(s), { a: '</script><script>alert(1)</script>', b: 'x & y', c: ' ' });
});

test('GUARD: the public-path reader really sees the gated routes as gated (not a vacuous pass)', () => {
  const prefixes = middlewarePublicPrefixes();
  assert.ok(prefixes.includes('/blog') && prefixes.includes('/pricing') && prefixes.includes('/share/'));
  for (const gated of ['/analysis', '/academy', '/decoder', '/match-report']) {
    assert.ok(!prefixes.includes(gated), `${gated} must not be in the public list`);
    assert.ok(!isPublic(gated), `${gated} must be gated`);
  }
});

test('pageMetadata: own title and text in the social preview too, canonical on the canonical host, optional noindex', async () => {
  const { pageMetadata } = await import('@/lib/seo/site');
  const m = pageMetadata({ title: 'Pricing – AngleMotion', description: 'Desc.', path: '/pricing' }) as any;
  assert.equal(m.title, 'Pricing – AngleMotion');
  assert.equal(m.alternates.canonical, `${SITE_URL}/pricing`);
  assert.equal(m.openGraph.title, 'Pricing – AngleMotion');
  assert.equal(m.openGraph.description, 'Desc.');
  assert.equal(m.openGraph.url, `${SITE_URL}/pricing`);
  assert.equal(m.twitter.title, 'Pricing – AngleMotion');
  assert.equal(m.robots, undefined);
  assert.deepEqual(pageMetadata({ title: 't', description: 'd', path: '/login', noindex: true }).robots, { index: false, follow: true });
});

test('every public page that sets its own metadata uses pageMetadata (so its social preview is its own)', () => {
  for (const f of ['app/pricing/page.tsx', 'app/coaches/page.tsx', 'app/privacy/page.tsx', 'app/terms/page.tsx', 'app/login/page.tsx']) {
    assert.match(readFileSync(path.join(root, f), 'utf8'), /pageMetadata\(/, `${f} should use pageMetadata`);
  }
});
