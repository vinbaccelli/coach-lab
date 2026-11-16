// A view-only client link has the same tabs as an edit link, and no add controls anywhere.
import { launch, contextFor, api, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Vera View' }) })).body.player.id;
await api(coach, `/api/players/${pid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'biometrics' }) });
const view = (await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'view' }) })).body.share;

const p = await (await contextFor(b, null, { mobile: true })).newPage();
p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
await p.goto(view.url, { waitUntil: 'domcontentloaded' });
await p.locator('[role="tab"]').first().waitFor({ timeout: 120000 });
const tabs = (await p.locator('[role="tab"]').allTextContents()).map((t) => t.replace(/\d+$/, '').trim());
ok(JSON.stringify(tabs) === JSON.stringify(['Overview', 'Timeline', 'Biometrics', 'Nutrition']), `view-only link: tabs ${JSON.stringify(tabs)}`);
await p.locator('[role="tab"]:has-text("Timeline")').click();
await p.waitForTimeout(1200);
ok((await p.locator('textarea[placeholder="Write a comment…"]').count()) === 0 && (await p.locator('button:has-text("Add picture")').count()) === 0, 'Timeline tab on a view-only link: no add controls');
await p.locator('[role="tab"]:has-text("Biometrics")').click();
await p.waitForTimeout(1200);
ok((await p.locator('[data-testid="tracker-Biometrics"]').count()) === 1 && (await p.locator('button:has-text("Add entry")').count()) === 0, 'Biometrics tab on a view-only link: the tracker, no "Add entry"');
await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall share-tabs-view checks passed');
process.exit(failures ? 1 : 0);
