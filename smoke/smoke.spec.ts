import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke test: the pages a coach hits first must load from a production build, with
 * no server error and no uncaught browser error. See docs/SMOKE_TEST.md.
 *
 * Every request that leaves the local server (Trustpilot, fonts, Google, Supabase…) is aborted,
 * so the test needs no network and cannot be flaky because of it. The browser's own
 * "Failed to load resource" line for such a request is therefore not an error here.
 */

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });
});

/** Collects everything that would make a coach see a broken page. */
function watch(page: Page, origin: string) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`uncaught error in the page: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/i.test(m.text())) return; // an aborted outside request
    problems.push(`console.error: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(origin) && r.status() >= 500) problems.push(`server error ${r.status()} for ${r.url()}`);
  });
  return problems;
}

/** Open `path`, wait for the page to settle, and fail with a plain sentence if anything is wrong. */
async function load(page: Page, baseURL: string, path: string, expectedStatus = 200) {
  const problems = watch(page, new URL(baseURL).origin);
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res, `${path}: no response from the server`).not.toBeNull();
  expect(res!.status(), `${path}: expected HTTP ${expectedStatus} but the server answered ${res!.status()}`).toBe(expectedStatus);
  await page.waitForLoadState('networkidle').catch(() => { /* a page that never goes idle is still checked below */ });
  await expect(page.locator('body'), `${path}: the page body is empty`).not.toBeEmpty();
  expect(await page.getByText('Application error').count(), `${path}: Next.js showed "Application error"`).toBe(0);
  return problems;
}

const clean = (path: string, problems: string[]) =>
  expect(problems, `${path} loaded, but with:\n  - ${problems.join('\n  - ')}`).toEqual([]);

test('landing page loads, with no server error and no uncaught console error', async ({ page, baseURL }) => {
  const problems = await load(page, baseURL!, '/');
  await expect(page.getByRole('heading', { level: 1 }).first(), '/: the landing page has no visible heading').toBeVisible();
  clean('/', problems);
});

test('pricing page loads', async ({ page, baseURL }) => {
  const problems = await load(page, baseURL!, '/pricing');
  await expect(page.getByText(/three plans/i).first(), '/pricing: the plans headline is missing').toBeVisible();
  clean('/pricing', problems);
});

test('login page loads, with a sign-in button', async ({ page, baseURL }) => {
  const problems = await load(page, baseURL!, '/login');
  await expect(
    page.getByRole('button', { name: /continue with google/i }),
    '/login: the "Continue with Google" button is missing (or Supabase settings were not picked up)',
  ).toBeVisible();
  clean('/login', problems);
});

test('privacy page loads', async ({ page, baseURL }) => {
  const problems = await load(page, baseURL!, '/privacy');
  await expect(page.getByRole('heading', { name: /privacy policy/i }), '/privacy: the "Privacy Policy" heading is missing').toBeVisible();
  clean('/privacy', problems);
});

test('signed-out visit to /analysis goes to sign-in and keeps the path', async ({ page, baseURL }) => {
  const problems = watch(page, new URL(baseURL!).origin);
  await page.goto('/analysis', { waitUntil: 'load' });
  const url = new URL(page.url());
  expect(url.pathname, `/analysis: a signed-out visitor should land on /login but ended on ${url.pathname}`).toBe('/login');
  // Only the path is asserted: whether the query string also survives is a separate behavior (KNOWN_ISSUES 081).
  expect(url.searchParams.get('redirect') ?? '', `/analysis: the sign-in redirect lost the original path (redirect=${url.searchParams.get('redirect')})`).toMatch(/^\/analysis(\?|$)/);
  await expect(page.getByRole('button', { name: /continue with google/i }), 'the sign-in page after the redirect has no sign-in button').toBeVisible();
  clean('/analysis → /login', problems);
});

test('an unknown path shows the 404 page', async ({ page, baseURL }) => {
  // Under a public prefix (/pricing/…), so the sign-in gate in middleware.ts lets the request through.
  // A signed-out visitor to an unknown path OUTSIDE the public list is sent to /login instead (see the next test).
  const path = '/pricing/this-page-does-not-exist';
  const problems = await load(page, baseURL!, path, 404);
  await expect(page.getByText(/could not be found|not found/i).first(), `${path}: the not-found page text is missing`).toBeVisible();
  // The browser logs the 404 itself as a console error; that is expected here and nothing else should be.
  expect(problems.filter((p) => !/404/.test(p)), `${path} showed the 404 page, but with:\n  - ${problems.join('\n  - ')}`).toEqual([]);
});

test('a signed-out visitor to an unknown page outside the public list is sent to sign-in (current behavior)', async ({ page }) => {
  await page.goto('/this-page-does-not-exist', { waitUntil: 'load' });
  expect(new URL(page.url()).pathname, 'an unknown private-looking path no longer goes to /login: the sign-in gate in middleware.ts changed').toBe('/login');
});
