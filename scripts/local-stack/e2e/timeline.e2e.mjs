// Universal timeline (PR F): every module in one list, newest first, filters, paging, manual order,
// no duplicates, and the share link's view limited to its sections. Phone viewport.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, contextFor, api, BASE, seedInfo } from '../browser.mjs';

const pg = createRequire(import.meta.url)('pg');
const SHOTS = process.env.E2E_SHOTS || '/tmp/coachlab-local-stack/shots';
const DB_URL = process.env.LOCAL_DB_URL || 'postgres://postgres@127.0.0.1:54322/coachlab';
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const keysOn = async (p, scope) => p.locator(`${scope} [data-testid="history-item"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const coachA = seedInfo().users.find((u) => u.key === 'coachA').id;

const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
coach.on('pageerror', (e) => { console.log('PAGEERROR(coach)', e.message); failures++; });
coach.on('dialog', (d) => d.accept());
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Tom Timeline' }) })).body.player.id;

// One item of every kind, on different days.
await api(coach, `/api/players/${pid}/timeline`, { method: 'POST', body: JSON.stringify({ kind: 'note', body: 'Coach comment today' }) });
await db.query("insert into public.player_entries (coach_id, player_id, category, folder_label, body_text, created_at) values ($1, $2, 'technique', 'Serve check', 'Toss too far left', now() - interval '3 days')", [coachA, pid]);
await db.query('update public.players set technical_sheet = $2 where id = $1', [pid, JSON.stringify([{ label: 'Forehand', value: '', kind: 'track', entries: [{ id: 'fh1', date: daysAgo(5), text: 'Late contact on the forehand' }] }])]);
const bio = (await api(coach, `/api/players/${pid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'biometrics' }) })).body.tracker;
await api(coach, `/api/players/${pid}/trackers/${bio.id}/entries`, { method: 'POST', body: JSON.stringify({ entry_date: daysAgo(2), measurements: { height: 180, weight: 74 } }) });
await api(coach, `/api/players/${pid}/nutrition/plans`, { method: 'POST', body: JSON.stringify({ title: 'Base plan', starts_on: daysAgo(10), targets: { calories: 2600 } }) });
await api(coach, `/api/players/${pid}/nutrition/plans`, { method: 'POST', body: JSON.stringify({ title: 'Secret draft', starts_on: daysAgo(1), status: 'draft' }) });
await api(coach, `/api/players/${pid}/meals`, { method: 'POST', body: JSON.stringify({ eaten_on: daysAgo(1), eaten_at: '13:00', category: 'lunch', description: 'Coach logged lunch', calories: 700 }) });
// An old progress value, copied into a tracker by the trackers migration: it must appear once.
const legacy = (await db.query("insert into public.player_metrics (coach_id, player_id, name, unit, value, recorded_on) values ($1, $2, 'Serve speed', 'km/h', 172, $3) returning id", [coachA, pid, daysAgo(20)])).rows[0].id;
await db.query(fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261114090000_player_trackers.sql'), 'utf8'));

await coach.goto(`${BASE}/players/${pid}?tab=timeline`, { waitUntil: 'networkidle' });
const feed = '[data-testid="history-feed"]';
await coach.locator(`${feed} [data-testid="history-item"]`).first().waitFor();
let keys = await keysOn(coach, feed);
const text = await coach.locator(feed).textContent();
ok(text.includes('Coach comment today') && text.includes('Technical report: Serve check') && text.includes('Late contact on the forehand'), 'comments, reports and technical notes are in one list');
ok(text.includes('Biometrics') && text.includes('Weight 74 kg') && text.includes('Coach logged lunch') && text.includes('Nutrition plan: Base plan'), 'measurements, meals and plans are in it too');
ok(!text.includes('Secret draft'), 'draft plans are not in the timeline');
ok(keys.filter((k) => k === `m-${legacy}`).length === 1 && text.split('Serve speed').length === 2, 'an old progress value copied into a tracker appears once, with its old key');
ok(keys[0].startsWith('i-') && keys[keys.length - 1] === `m-${legacy}`, 'newest first (today’s comment on top, the 20-day-old value last)');
await coach.screenshot({ path: `${SHOTS}/f-coach-timeline.png`, fullPage: true });

// Filters
await coach.click(`${feed} button:has-text("Filter")`);
await coach.click(`[data-testid="history-filters"] button:has-text("Meals")`);
await coach.waitForTimeout(1500);
keys = await keysOn(coach, feed);
ok(keys.length === 1 && keys[0].startsWith('meal-'), `kind filter: only meals (${keys.join(',')})`);
await coach.click(`[data-testid="history-filters"] button:has-text("Meals")`);
await coach.click(`[data-testid="history-filters"] [role="group"][aria-label="Section"] button:has-text("Biometrics")`);
await coach.waitForTimeout(1500);
keys = await keysOn(coach, feed);
ok(keys.length === 1 && keys[0].startsWith('t-'), `section filter: only the biometrics entry (${keys.join(',')})`);
await coach.click(`${feed} button:has-text("Clear filters")`);
await coach.click(`${feed} button:has-text("Filter")`).catch(() => {});
if (!(await coach.locator('[data-testid="history-filters"]').count())) await coach.click(`${feed} button:has-text("Filter")`);
await coach.locator('[data-testid="history-filters"] input[aria-label="From"]').fill(daysAgo(6));
await coach.locator('[data-testid="history-filters"] input[aria-label="To"]').fill(daysAgo(2));
await coach.waitForTimeout(1500);
keys = await keysOn(coach, feed);
ok(keys.length === 3 && keys.includes('ts-fh1') && keys.some((k) => k.startsWith('e-')) && keys.some((k) => k.startsWith('t-')), `date filter: the report, the technical note and the measurement (${keys.join(',')})`);
await coach.click(`${feed} button:has-text("Clear filters")`);

// Paging: 35 more comments; 30 per page, "Load older" brings the rest, nothing twice.
for (let i = 0; i < 35; i++) await api(coach, `/api/players/${pid}/timeline`, { method: 'POST', body: JSON.stringify({ kind: 'note', body: `Bulk ${i}` }) });
let r = await api(coach, `/api/players/${pid}/history?limit=30`);
ok(r.body.items.length === 30 && r.body.next, 'the first page has 30 items and a cursor');
const p2 = await api(coach, `/api/players/${pid}/history?limit=30&before=${encodeURIComponent(r.body.next)}`);
const all = [...r.body.items, ...p2.body.items].map((x) => x.key);
ok(p2.body.next === null && new Set(all).size === all.length && all.length === 35 + 7, `two pages hold every item exactly once (${all.length})`);
await coach.reload({ waitUntil: 'networkidle' });
await coach.locator(`${feed} [data-testid="history-item"]`).first().waitFor();
ok((await coach.locator(`${feed} [data-testid="history-item"]`).count()) === 30, 'the page shows 30 items first');
await coach.click(`${feed} button:has-text("Load older")`);
await coach.waitForTimeout(1500);
keys = await keysOn(coach, feed);
ok(keys.length === 42 && new Set(keys).size === 42, `"Load older" adds the rest without duplicates (${keys.length})`);

// Manual order (saved by dragging; set here through the same API) applies to the whole list; new items stay on top.
const plan = keys.find((k) => k.startsWith('plan-'));
const report = keys.find((k) => k.startsWith('e-'));
r = await api(coach, `/api/players/${pid}`, { method: 'PATCH', body: JSON.stringify({ timeline_order: [plan, report, ...keys.filter((k) => k !== plan && k !== report)] }) });
ok(r.status === 200, 'manual order saved');
await coach.reload({ waitUntil: 'networkidle' });
await coach.locator(`${feed} [data-testid="history-item"]`).first().waitFor();
keys = await keysOn(coach, feed);
ok(keys[0] === plan && keys[1] === report && keys.length === 42, 'the saved order is applied to the whole timeline');
await api(coach, `/api/players/${pid}/timeline`, { method: 'POST', body: JSON.stringify({ kind: 'note', body: 'Newest after ordering' }) });
await coach.reload({ waitUntil: 'networkidle' });
await coach.locator(`${feed} [data-testid="history-item"]`).first().waitFor();
keys = await keysOn(coach, feed);
ok((await coach.locator(`${feed} [data-testid="history-item"]`).first().textContent()).includes('Newest after ordering') && keys[1] === plan, 'a new item stays on top of the manual order');
const grips = await coach.locator(`${feed} [aria-label="Drag to reorder"]`).count();
ok(grips > 0, `the coach can drag items (${grips} grips)`);

// Delete a comment from the timeline
const bulk0 = coach.locator(`${feed} [data-testid="history-item"]`, { hasText: 'Bulk 0' });
await bulk0.locator('button[aria-label="Delete"]').click();
await coach.waitForTimeout(1500);
ok((await coach.locator(`${feed} [data-testid="history-item"]`, { hasText: 'Bulk 0' }).count()) === 0, 'a comment can be deleted from the timeline');

// ── The player's view ──────────────────────────────────────────────────
r = await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit' }) });
const link = r.body.share.url;
const token = link.split('/share/')[1];
await api(coach, `/api/players/${pid}`, { method: 'PATCH', body: JSON.stringify({ timeline_order: null }) });
const sp = await (await contextFor(b, null, { mobile: true })).newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(player)', e.message); failures++; });
await sp.goto(link, { waitUntil: 'networkidle' });
await api(sp, `/api/share/${token}/meals`, { method: 'POST', body: JSON.stringify({ eaten_on: daysAgo(0), category: 'snack', description: 'Player snack', calories: 200 }) });
await api(sp, `/api/share/${token}`, { method: 'POST', body: JSON.stringify({ kind: 'note', body: 'Player says hi' }) });
await sp.reload({ waitUntil: 'networkidle' });
await sp.locator(`${feed} [data-testid="history-item"]`).first().waitFor();
let stext = await sp.locator(feed).textContent();
ok(stext.includes('Player says hi') && stext.includes('Player snack'), 'the player’s own items are on top of their timeline');
r = await api(sp, `/api/share/${token}/history?limit=100`);
const sAll = r.body.items.map((x) => x.title + ' ' + (x.body ?? '')).join(' | ');
ok(sAll.includes('Late contact on the forehand') && sAll.includes('Weight 74 kg') && sAll.includes('Coach logged lunch') && sAll.includes('Base plan'), 'the player’s timeline also holds the coach’s items of visible sections');
ok(!stext.includes('Serve check'), 'reports are never in the player’s timeline');
r = await api(sp, `/api/share/${token}/history?types=report`);
ok(r.status === 200 && r.body.items.length === 0, 'the server sends no report through the link');
await sp.click(`${feed} button:has-text("Filter")`);
await sp.click('[data-testid="history-filters"] button:has-text("Me")');
await sp.waitForTimeout(1500);
const mine = await keysOn(sp, feed);
ok(mine.length === 2 && mine.every((k) => k.startsWith('i-') || k.startsWith('meal-')), `"Added by: Me" shows the player's own items (${mine.join(',')})`);
// Added after the check above failed (Rule 8: that check is left as it was, reported, awaiting approval):
// its selector has-text("Me") also matches "Biometrics", which comes first. Same intent, exact name.
await sp.click(`${feed} button:has-text("Clear filters")`);
if (!(await sp.locator('[data-testid="history-filters"]').count())) await sp.click(`${feed} button:has-text("Filter")`);
await sp.getByRole('radio', { name: 'Me', exact: true }).click();
await sp.waitForTimeout(1500);
const mineExact = await keysOn(sp, feed);
ok(mineExact.length === 2 && mineExact.every((k) => k.startsWith('i-') || k.startsWith('meal-')), `"Added by: Me" (exact button) shows the player's own items (${mineExact.join(',')})`);
await sp.screenshot({ path: `${SHOTS}/f-player-timeline.png`, fullPage: true });

await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { nutrition: false, biometrics: false } } }) });
r = await api(sp, `/api/share/${token}/history?limit=100`);
ok(r.status === 200 && !r.body.items.some((x) => x.section === 'nutrition' || x.section === 'biometrics'), 'hidden sections are not sent in the timeline');
r = await api(sp, `/api/share/${token}/history?sections=nutrition`);
ok(r.status === 200 && r.body.items.length === 0, 'asking for a hidden section returns nothing');
await sp.reload({ waitUntil: 'networkidle' });
await sp.locator(`${feed} [data-testid="history-item"]`).first().waitFor();
stext = await sp.locator(feed).textContent();
ok(!stext.includes('Player snack') && !stext.includes('Weight 74 kg'), 'the page shows no hidden section');

// Another coach cannot read this timeline
const other = await (await contextFor(b, 'coachB', { mobile: true })).newPage();
await other.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
r = await api(other, `/api/players/${pid}/history`);
ok(r.status === 404, `another coach gets 404 (${r.status})`);

await db.end();
await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall timeline checks passed');
process.exit(failures ? 1 : 0);
