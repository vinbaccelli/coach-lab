// Browser + API checks for the tracker engine (Progress / Biometrics / Fitness) on the local stack.
// Run: scripts/local-stack/start.sh && scripts/local-stack/dev.sh (other shell) && node scripts/local-stack/e2e/trackers.e2e.mjs
import pg from 'pg';
import { launch, contextFor, api, BASE } from '../browser.mjs';

const SHOTS = process.env.E2E_SHOTS || '/tmp/coachlab-local-stack/shots';
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const db = new pg.Client({ connectionString: process.env.LOCAL_DB_URL || 'postgres://postgres@127.0.0.1:54322/coachlab' });
await db.connect();
const fs = await import('node:fs');
fs.mkdirSync(SHOTS, { recursive: true });

const b = await launch();
const ctx = await contextFor(b, 'coachA', { mobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
/** Do `fn` and wait until the API call it triggers has answered. */
async function act(p, method, urlPart, fn) {
  const w = p.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === method, { timeout: 180000 });
  await fn();
  const res = await w;
  await p.waitForTimeout(200);
  return res;
}

// ── Workflow A: new athlete ────────────────────────────────────────────────
let r = await api(page, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Ana Trackers' }) });
const pid = r.body.player.id;
ok(JSON.stringify(r.body.player.technical_sheet).match(/"Forehand"|"Backhand"|"Serve"|"Volley"|"Footwork"/g)?.length === 5, 'new player gets the five standard tracking rows');

await page.goto(`${BASE}/players/${pid}?tab=biometrics`, { waitUntil: 'networkidle' });
await act(page, 'POST', '/trackers', () => page.click('text=Start biometrics'));
await page.waitForSelector('[data-testid="tracker-Biometrics"]');
const bio = page.locator('[data-testid="tracker-Biometrics"]');
await bio.locator('button:has-text("Add entry")').click();
await bio.locator('input[aria-label="Height"]').fill('175');
await bio.locator('input[aria-label="Weight"]').fill('70');
await act(page, 'POST', '/entries', () => bio.locator('button:has-text("Save entry")').click());
await bio.locator('button:has-text("Add entry")').click();
await bio.locator('input[type="date"]').fill('2026-02-10');
await bio.locator('input[aria-label="Weight"]').fill('72');
await act(page, 'POST', '/entries', () => bio.locator('button:has-text("Save entry")').click());
let txt = await bio.textContent();
ok(/BMI 22\.9/.test(txt) && /BMI 23\.5/.test(txt), `BMI calculated from weight + carried-forward height (${(txt.match(/BMI [0-9.]+/g) || []).join(', ')})`);
ok((await bio.locator('svg[role="img"]').count()) === 1, 'biometrics chart drawn');
await page.screenshot({ path: `${SHOTS}/c-biometrics.png`, fullPage: true });

// Fitness: squat (sets) and run (lower time is better)
await page.goto(`${BASE}/players/${pid}?tab=fitness`, { waitUntil: 'networkidle' });
await act(page, 'POST', '/trackers', () => page.click('button:has-text("+ Squat")'));
await page.waitForSelector('[data-testid="tracker-Squat"]');
const sq = page.locator('[data-testid="tracker-Squat"]');
await sq.locator('button:has-text("Add entry")').click();
await sq.locator('input[type="date"]').fill('2026-01-10');
await sq.locator('input[aria-label="Reps"]').nth(0).fill('10');
await sq.locator('input[aria-label="Weight"]').nth(0).fill('40');
await sq.locator('button:has-text("Add set")').click();
await sq.locator('button:has-text("Add set")').click();
await act(page, 'POST', '/entries', () => sq.locator('button:has-text("Save entry")').click());
await sq.locator('button:has-text("Add entry")').click();
await sq.locator('button:has-text("Same as last time")').click();
await sq.locator('input[aria-label="Weight"]').nth(0).fill('45');
await sq.locator('input[aria-label="Weight"]').nth(1).fill('45');
await sq.locator('input[aria-label="Weight"]').nth(2).fill('45');
await act(page, 'POST', '/entries', () => sq.locator('button:has-text("Save entry")').click());
txt = await sq.textContent();
ok(txt.includes('3 sets: 10 × 40 kg, 10 × 40 kg, 10 × 40 kg') && txt.includes('3 sets: 10 × 45 kg'), 'squat sets recorded (Add set copies the last set; Same as last time)');
ok(['Top weight', 'Total reps', 'Volume', 'Sets'].every((l) => txt.includes(l)), 'set-based tracker offers top weight / total reps / volume / sets charts');
ok(/Top weight: 45 kg/.test(txt.replace(/\s+/g, ' ')), 'squat summary shows top weight 45 kg');

await act(page, 'POST', '/trackers', () => page.click('button:has-text("+ Running")'));
await page.waitForSelector('[data-testid="tracker-5 km run"]');
const run = page.locator('[data-testid="tracker-5 km run"]');
for (const [d, t] of [['2026-01-10', '28:00'], ['2026-02-05', '24:00']]) {
  await run.locator('button:has-text("Add entry")').click();
  await run.locator('input[type="date"]').fill(d);
  await run.locator('input[aria-label="Distance"]').fill('5');
  await run.locator('input[aria-label="Time"]').fill(t);
  await act(page, 'POST', '/entries', () => run.locator('button:has-text("Save entry")').click());
}
txt = (await run.textContent()).replace(/\s+/g, ' ');
ok(/Time: 24:00/.test(txt) && /▼ 4:00/.test(txt), 'run shows time 24:00 and a 4:00 improvement');
ok(/Pace 4:48 \/km/.test(txt), 'pace calculated (24:00 / 5 km = 4:48 /km)');
const runColor = await run.locator('text=▼').first().evaluate((el) => getComputedStyle(el).color);
ok(runColor === 'rgb(29, 122, 54)', `a lower run time is shown as an improvement (green, got ${runColor})`);
await page.screenshot({ path: `${SHOTS}/c-fitness.png`, fullPage: true });

// Reorder: drag the run above the squat
// The cards are taller than the phone screen: carry the run's handle to the top edge and hold, the
// list scrolls up under the finger until the run passes the squat.
const handles = page.locator('[aria-label="Drag to reorder"]');
await handles.nth(1).scrollIntoViewIfNeeded();
const h2 = await handles.nth(1).boundingBox();
await page.mouse.move(h2.x + 8, h2.y + 8);
await page.mouse.down();
await page.mouse.move(h2.x + 8, 30, { steps: 12 });
await page.waitForTimeout(2500);
await act(page, 'POST', '/trackers/reorder', () => page.mouse.up());
r = await api(page, `/api/players/${pid}/trackers?category=fitness`);
ok(r.body.trackers.map((t) => t.name).join(',') === '5 km run,Squat', `tracker order saved (${r.body.trackers.map((t) => t.name).join(',')})`);

// Custom progress tracker
await page.goto(`${BASE}/players/${pid}?tab=progress`, { waitUntil: 'networkidle' });
await page.click('button:has-text("New tracker")');
await page.fill('input[placeholder="e.g. Serve speed, Squat, Weight"]', 'Serve speed');
await page.fill('input[aria-label="Measurement name"]', 'First serve');
await page.selectOption('select[aria-label="Type"]', 'speed');
await page.selectOption('select[aria-label="Better when"]', 'higher');
await act(page, 'POST', '/trackers', () => page.click('button:has-text("Save")'));
await page.waitForSelector('[data-testid="tracker-Serve speed"]');
const sv = page.locator('[data-testid="tracker-Serve speed"]');
await sv.locator('button:has-text("Add entry")').click();
await sv.locator('input[aria-label="First serve"]').fill('152');
await act(page, 'POST', '/entries', () => sv.locator('button:has-text("Save entry")').click());
ok((await sv.textContent()).includes('First serve 152 km/h'), 'custom tracker with a speed measurement works');

// Edit tracker: add a field from the biometrics suggestions, rename an existing one
await page.goto(`${BASE}/players/${pid}?tab=biometrics`, { waitUntil: 'networkidle' });
await page.click('[aria-label="Biometrics options"]');
await page.click('text=Edit tracker');
await page.click('button:has-text("+ Muscle mass")');
await page.locator('input[aria-label="Measurement name"]').nth(3).fill('Body fat (skinfold)');
await act(page, 'PATCH', '/trackers/', () => page.click('button:has-text("Save")'));
r = await api(page, `/api/players/${pid}/trackers?category=biometrics`);
const f = r.body.trackers[0].fields;
ok(f.some((x) => x.id === 'muscle_mass') && f.find((x) => x.id === 'body_fat')?.label === 'Body fat (skinfold)', 'tracker edited: field added, field renamed (id kept)');

// API: stale edit -> 409, duplicate submit -> one entry, removing a field with history -> refused
const tr = r.body.trackers[0];
r = await api(page, `/api/players/${pid}/trackers/${tr.id}`, { method: 'PATCH', body: JSON.stringify({ archived: false, expected_updated_at: '2020-01-01T00:00:00Z' }) });
ok(r.status === 409, `stale edit is refused (409, got ${r.status})`);
const ref = '8d6f1d4c-5c3b-4c55-9a3b-2a6f1c2d3e4f';
const e1 = await api(page, `/api/players/${pid}/trackers/${tr.id}/entries`, { method: 'POST', body: JSON.stringify({ entry_date: '2026-03-01', measurements: { weight: 73 }, client_ref: ref }) });
const e2 = await api(page, `/api/players/${pid}/trackers/${tr.id}/entries`, { method: 'POST', body: JSON.stringify({ entry_date: '2026-03-01', measurements: { weight: 73 }, client_ref: ref }) });
ok(e1.status === 200 && e2.status === 200 && e1.body.entry.id === e2.body.entry.id && e2.body.duplicate === true, 'a double submit with the same client_ref saves once');
r = await api(page, `/api/players/${pid}/trackers/${tr.id}`, { method: 'PATCH', body: JSON.stringify({ definition: { ...tr, fields: tr.fields.filter((x) => x.id !== 'lean_mass') } }) });
ok(r.status === 400 && /archive/.test(r.body.error), 'removing a measurement with history is refused (archive instead)');
r = await api(page, `/api/players/${pid}/trackers/${tr.id}/entries`, { method: 'POST', body: JSON.stringify({ measurements: { bmi: 30 } }) });
ok(r.status === 400, 'a calculated field (BMI) cannot be typed in');

// Edit + delete an entry through the UI
await page.reload({ waitUntil: 'networkidle' });
const bio2 = page.locator('[data-testid="tracker-Biometrics"]');
await bio2.locator('[aria-label="Edit entry"]').first().click();
await bio2.locator('input[aria-label="Weight"]').fill('73.5');
await act(page, 'PATCH', '/tracker-entries/', () => bio2.locator('button:has-text("Save changes")').click());
ok((await bio2.textContent()).includes('Weight 73.5 kg'), 'entry edited in place');
const before = (await api(page, `/api/players/${pid}/trackers?category=biometrics`)).body.entries.length;
await act(page, 'DELETE', '/tracker-entries/', () => bio2.locator('[aria-label="Delete entry"]').first().click());
const after = (await api(page, `/api/players/${pid}/trackers?category=biometrics`)).body.entries.length;
ok(after === before - 1, `entry deleted (${before} -> ${after})`);

// Profile photo upload
await page.goto(`${BASE}/players/${pid}`, { waitUntil: 'networkidle' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await act(page, 'POST', '/photo', () => page.setInputFiles('input[type=file][accept="image/*"]', { name: 'p.png', mimeType: 'image/png', buffer: png }));
r = await api(page, `/api/players/${pid}`);
ok(/\/storage\/v1\/object\/public\/player-assets\/11111111-1111-4111-8111-111111111111\//.test(r.body.player.photo_url || ''), 'profile photo uploaded to the coach folder and saved');
ok((await page.locator(`img[alt="Ana Trackers"]`).count()) === 1, 'profile photo shown in the header');
await page.screenshot({ path: `${SHOTS}/c-overview.png`, fullPage: true });

// ── Legacy progress values were migrated into trackers ───────────────────
const { rows: smoke } = await db.query("select id from public.players where display_name = 'Smoke Player' limit 1");
if (smoke.length) {
  await page.goto(`${BASE}/players/${smoke[0].id}?tab=progress`, { waitUntil: 'networkidle' });
  txt = await page.textContent('body');
  ok(txt.includes('Weight') && txt.includes('5 km run'), 'old progress values appear as trackers in Progress');
}

// ── Share link: trackers read-only, value sent by the player waits for review ──
r = await api(page, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit' }) });
const link = r.body.share?.url;
const anon = await contextFor(b, null, { mobile: true });
const sp = await anon.newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(share)', e.message); failures++; });
await sp.goto(link, { waitUntil: 'networkidle' });
const stxt = await sp.textContent('body');
ok(stxt.includes('Biometrics') && stxt.includes('Squat') && stxt.includes('Serve speed'), 'share page shows the trackers');
ok((await sp.locator('button:has-text("Add entry")').count()) === 0, 'share page trackers are read-only in this PR');
await sp.fill('input[placeholder="What (e.g. 5 km run)"]', 'Serve speed');
await sp.fill('input[placeholder="Unit"]', 'km/h');
await sp.fill('input[placeholder="Value"]', '158');
await act(sp, 'POST', '/api/share/', () => sp.click('button:has-text("Add value")'));
await sp.screenshot({ path: `${SHOTS}/c-share.png`, fullPage: true });
await page.goto(`${BASE}/players/${pid}?tab=progress`, { waitUntil: 'networkidle' });
txt = await page.textContent('body');
ok(/1 to review/.test(txt), 'coach sees the player value waiting for review');
ok((txt.match(/Serve speed/g) || []).length >= 1 && (await page.locator('[data-testid="tracker-Serve speed"]').count()) === 1, 'the player value went into the existing Serve speed tracker (no duplicate tracker)');
await act(page, 'PATCH', '/tracker-entries/', () => page.click('button:has-text("Approve")'));
r = await api(page, `/api/players/${pid}/trackers?category=progress`);
ok(r.body.entries.some((e) => e.author === 'link' && e.status === 'approved'), 'coach approved the player value');

// ── RLS: another coach sees nothing and cannot write ────────────────────
const ctxB = await contextFor(b, 'coachB');
const pb = await ctxB.newPage();
await pb.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
r = await api(pb, `/api/players/${pid}/trackers`);
ok(r.status === 200 && r.body.trackers.length === 0, 'coach B cannot read coach A trackers');
r = await api(pb, `/api/players/${pid}/trackers/${tr.id}/entries`, { method: 'POST', body: JSON.stringify({ measurements: { weight: 1 } }) });
ok(r.status === 404, `coach B cannot add an entry to coach A's tracker (${r.status})`);
r = await api(pb, `/api/players/${pid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'squat' }) });
ok(r.status === 403, `coach B cannot create a tracker on coach A's player (${r.status})`);
const { rows: cnt } = await db.query('select count(*)::int n from public.player_trackers where player_id = $1', [pid]);
ok(cnt[0].n === 4, `no tracker was added by coach B (${cnt[0].n})`);

// ── Missing tables: the section says so, the rest of the page works ──────
await db.query('alter table public.player_trackers rename to player_trackers_off');
try {
  await page.goto(`${BASE}/players/${pid}?tab=fitness`, { waitUntil: 'networkidle' });
  txt = await page.textContent('body');
  ok(txt.includes('needs a one-time database update'), 'missing tables: section shows the setup notice');
  await page.goto(`${BASE}/players/${pid}?tab=progress`, { waitUntil: 'networkidle' });
  ok((await page.textContent('body')).includes('Track something new') || (await page.textContent('body')).includes('Progress tracking'), 'missing tables: the old progress card is still shown in Progress');
  await page.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
  ok((await page.textContent('body')).includes('Save profile'), 'missing tables: the rest of the profile still works');
  await sp.reload({ waitUntil: 'networkidle' });
  ok((await sp.textContent('body')).includes('Ana Trackers'), 'missing tables: the share page still works');
} finally {
  await db.query('alter table public.player_trackers_off rename to player_trackers');
}

await b.close();
await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
