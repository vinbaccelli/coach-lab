// The client's share link has the same tabs as the coach's profile (only the ones that link may see and that
// have something to show), not one long page.
import { launch, contextFor, api, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const tabsOf = (p) => p.locator('[role="tab"]').allTextContents().then((a) => a.map((t) => t.replace(/\d+$/, '').trim()));

const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Tabby Client' }) })).body.player.id;
await api(coach, `/api/players/${pid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'biometrics' }) });
const edit = (await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit' }) })).body.share;

const open = async (url) => {
  const ctx = await contextFor(b, null, { mobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.locator('[role="tab"]').first().waitFor({ timeout: 120000 });
  return p;
};

const sp = await open(edit.url);
const tabs = await tabsOf(sp);
ok(JSON.stringify(tabs) === JSON.stringify(['Overview', 'Timeline', 'Progress', 'Biometrics', 'Nutrition']), `edit link at 390 px: tabs follow the profile order, only what has something to show ${JSON.stringify(tabs)}`);
ok((await sp.locator('[data-testid="share-overview"]').count()) === 1, 'Overview is the default tab');
ok((await sp.locator('textarea[placeholder="Write a comment…"]').count()) === 0, 'the timeline form is not shown on the Overview (own tab)');

await sp.locator('[role="tab"]:has-text("Timeline")').click();
await sp.waitForTimeout(1200);
ok((await sp.locator('textarea[placeholder="Write a comment…"]').count()) === 1 && (await sp.locator('button:has-text("Add picture")').count()) === 1, 'Timeline tab: comment and picture controls');
await sp.locator('[role="tab"]:has-text("Biometrics")').click();
await sp.waitForTimeout(1200);
ok((await sp.locator('[data-testid="tracker-Biometrics"]').count()) === 1, 'Biometrics tab shows the tracker');
await sp.locator('[role="tab"]:has-text("Nutrition")').click();
await sp.waitForTimeout(1500);
ok((await sp.textContent('body')).includes('Nutrition'), 'Nutrition tab shows the nutrition section');
ok((await sp.evaluate(() => new URL(location.href).searchParams.get('tab'))) === 'nutrition', 'the chosen tab is kept in the link (?tab=)');
const sp2 = await open(edit.url + '?tab=biometrics');
ok((await sp2.locator('[data-testid="tracker-Biometrics"]').count()) === 1, 'a link with ?tab=biometrics opens on that tab');

// Hide nutrition and the timeline for a second link: those tabs disappear.
const hidden = (await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { nutrition: false, timeline: false } } }) })).body.share;
const hp = await open(hidden.url);
const ht = await tabsOf(hp);
ok(!ht.includes('Nutrition') && !ht.includes('Timeline'), `hidden sections have no tab ${JSON.stringify(ht)}`);

// A view-only link has tabs too and no add controls.
const view = (await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'view' }) })).body.share;
const vp = await open(view.url);
console.log('view tabs', JSON.stringify(await tabsOf(vp))); await vp.locator('[role="tab"]:has-text("Timeline")').click();
await vp.waitForTimeout(1200);
ok((await vp.locator('textarea[placeholder="Write a comment…"]').count()) === 0, 'view-only link: tabs, but no add controls');

await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall share-tabs checks passed');
process.exit(failures ? 1 : 0);
