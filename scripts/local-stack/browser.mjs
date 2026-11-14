// Playwright helpers for the local stack: a signed-in page for a seeded test account.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const DIR = process.env.LOCAL_STACK_DIR || '/tmp/coachlab-local-stack';
export const BASE = process.env.APP_URL || 'http://localhost:3000';
export const seedInfo = () => JSON.parse(fs.readFileSync(`${DIR}/seed.json`, 'utf8'));

export async function launch() { return chromium.launch(); }

/** A browser context signed in as `userKey` (coachA, coachB, coachLight, coachFree), or anonymous when null. */
export async function contextFor(browser, userKey, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: 1, ...opts.context });
  if (userKey) {
    const u = seedInfo().users.find((x) => x.key === userKey);
    await ctx.addCookies([{ name: u.cookie.name, value: u.cookie.value, domain: 'localhost', path: '/', httpOnly: false, sameSite: 'Lax' }]);
  }
  // `next dev` compiles a page on its first visit, which can take well over the 30 s default.
  ctx.setDefaultNavigationTimeout(240000);
  ctx.setDefaultTimeout(60000);
  // The guided tour overlay would cover the page on first visit.
  await ctx.addInitScript(() => { try { localStorage.setItem('anglemotion:tour-dismissed', '1'); } catch {} });
  return ctx;
}

/** fetch() from inside the page (same cookies as the app), returning { status, body }. */
export async function api(page, path, init = {}) {
  return page.evaluate(async ([p, i]) => {
    const r = await fetch(p, { ...i, headers: { 'Content-Type': 'application/json', ...(i.headers || {}) } });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, [path, init]);
}
