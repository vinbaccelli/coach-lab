import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeRedirectPath } from '@/lib/billing/checkoutIntent';

const ORIGIN = 'https://app.example';

/** Where the browser ends up after sign-in, from a path the middleware put in `redirect`. */
function landing(redirectParam: string | null): URL {
  // /login?redirect=<param>  (LoginPage)  →  /auth/callback?redirect=<same>  (LoginClient)  →  redirect (callback route)
  const loginPath = safeRedirectPath(redirectParam);
  const callback = new URL(`${ORIGIN}/auth/callback?redirect=${encodeURIComponent(loginPath)}`);
  return new URL(safeRedirectPath(callback.searchParams.get('redirect')), ORIGIN);
}

test('the query string survives: /analysis?vdebug=1 comes back as /analysis?vdebug=1', () => {
  assert.equal(safeRedirectPath('/analysis?vdebug=1'), '/analysis?vdebug=1');
  assert.equal(landing('/analysis?vdebug=1').href, `${ORIGIN}/analysis?vdebug=1`);
  assert.equal(landing('/analysis?vdebug=1&x=a%26b').href, `${ORIGIN}/analysis?vdebug=1&x=a%26b`);
  assert.equal(landing('/pricing?plan=pro&interval=yearly').href, `${ORIGIN}/pricing?plan=pro&interval=yearly`);
  assert.equal(landing('/analysis').href, `${ORIGIN}/analysis`);
});

test('middleware stores pathname + query in `redirect` (and drops the stray query from /login)', () => {
  const mw = readFileSync('middleware.ts', 'utf8');
  assert.ok(mw.includes("url.pathname = '/login';"));
  assert.ok(mw.includes("url.searchParams.set('redirect', pathname + req.nextUrl.search)"));
  assert.ok(mw.indexOf("url.search = ''") < mw.indexOf("url.searchParams.set('redirect'"));
  // Same formula, run: what /login receives for a request to /analysis?vdebug=1.
  const login = new URL(`${ORIGIN}/analysis?vdebug=1`);
  login.pathname = '/login';
  const search = login.search;
  login.search = '';
  login.searchParams.set('redirect', '/analysis' + search);
  assert.equal(login.href, `${ORIGIN}/login?redirect=%2Fanalysis%3Fvdebug%3D1`);
  assert.equal(landing(login.searchParams.get('redirect')).href, `${ORIGIN}/analysis?vdebug=1`);
});

test('external targets are rejected: absolute URLs, //host, javascript:, backslashes, dot-segment tricks', () => {
  const hostile = [
    'https://evil.com', 'http://evil.com/analysis', 'HTTPS://evil.com', '//evil.com', '//evil.com/analysis', '///evil.com',
    '/\\evil.com', '\\\\evil.com', '\\/evil.com', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'evil.com', 'analysis',
    '/\tevil.com', '/\n/evil.com', '/\r//evil.com', ' //evil.com',
    // The parser removes the dot segments and leaves `//evil.com`.
    '/.//evil.com', '/.///evil.com', '/a/..//evil.com', '/..//evil.com', '/foo/../..//evil.com', '/././/evil.com',
    '', null, undefined,
  ];
  for (const bad of hostile) {
    const out = safeRedirectPath(bad as string | null | undefined);
    assert.equal(out, '/', `rejected: ${JSON.stringify(bad)}`);
    assert.equal(landing(bad as string | null).origin, ORIGIN, `still on this site: ${JSON.stringify(bad)}`);
  }
});

test('a custom fallback is used for rejected targets; harmless look-alikes are kept', () => {
  assert.equal(safeRedirectPath('//evil.com', '/analysis'), '/analysis');
  assert.equal(safeRedirectPath('/.//evil.com', '/analysis'), '/analysis');
  // Not a host: the colon, // and @ sit in the query or fragment, or the path begins with a normal segment.
  for (const ok of ['/analysis?next=//evil.com', '/analysis?u=https://evil.com', '/analysis#//evil.com', '/%2f/evil.com', '/a//b', '/a/./b', '/javascript:alert(1)//', '/%0d%0aLocation:https://evil.com']) {
    assert.equal(landing(ok).origin, ORIGIN, ok);
  }
});

test('wiring: both the login page and the callback pass the parameter through safeRedirectPath', () => {
  const page = readFileSync('app/login/page.tsx', 'utf8');
  const cb = readFileSync('app/auth/callback/route.ts', 'utf8');
  assert.ok(page.includes('safeRedirectPath(sp.redirect)'));
  assert.ok(cb.includes("safeRedirectPath(searchParams.get('redirect'))"));
  const client = readFileSync('app/login/LoginClient.tsx', 'utf8');
  assert.ok(client.includes('/auth/callback?redirect=${encodeURIComponent(redirect)}'));
});
