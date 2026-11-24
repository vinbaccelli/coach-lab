// Nutrition (PR E): the coach's versioned plans and meal diary, and the player logging meals through
// the share link with the coach's review. Phone viewport. Server-side permission checks included.
import zlib from 'node:zlib';
import { launch, contextFor, api, BASE } from '../browser.mjs';

const SHOTS = process.env.E2E_SHOTS || '/tmp/coachlab-local-stack/shots';
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
async function act(p, method, urlPart, fn) {
  const w = p.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === method, { timeout: 180000 });
  await fn();
  const res = await w;
  await p.waitForTimeout(400);
  return res;
}
const ymd = (d) => d.toISOString().slice(0, 10);
const today = ymd(new Date());
const tomorrow = ymd(new Date(Date.now() + 86400000));

/** A real (decodable) PNG of w×h pixels in one colour, so the page can shrink it like a phone photo. */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const photo = (name, rgb) => ({ name, mimeType: 'image/png', buffer: png(40, 30, rgb) });

const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
coach.on('pageerror', (e) => { console.log('PAGEERROR(coach)', e.message); failures++; });
coach.on('dialog', (d) => d.accept());
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
let r = await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Nina Nutrition' }) });
const pid = r.body.player.id;

// ── Coach: a plan ────────────────────────────────────────────────────────
await coach.goto(`${BASE}/players/${pid}?tab=nutrition`, { waitUntil: 'networkidle' });
const sec = coach.locator('[data-testid="nutrition-section"]');
ok((await sec.textContent()).includes('No plan in force today.'), 'a new player has no plan yet');
await sec.locator('button:has-text("Create a plan")').click();
let ed = sec.locator('[data-testid="plan-editor"]');
await ed.locator('input[aria-label="Plan name"]').fill('Pre-season');
await ed.locator('input[aria-label="Calories (kcal)"]').fill('2500');
await ed.locator('input[aria-label="Protein (g)"]').fill('150');
await ed.locator('input[aria-label="Carbs (g)"]').fill('300');
await ed.locator('input[aria-label="Fat (g)"]').fill('80');
await ed.locator('button:has-text("Other target")').click();
await ed.locator('input[aria-label="Custom target name"]').fill('Water');
await ed.locator('input[aria-label="Custom target amount"]').fill('3');
await ed.locator('input[aria-label="Custom target unit"]').fill('L');
await ed.getByRole('button', { name: 'Meal', exact: true }).click();
await ed.locator('input[aria-label="Meal name"]').fill('Breakfast');
await ed.locator('input[aria-label="Meal time"]').fill('07:30');
await ed.locator('textarea[aria-label="What to eat"]').fill('Oats, banana, milk');
await ed.locator('textarea[aria-label="Notes"]').fill('Drink before you are thirsty.');
await act(coach, 'POST', '/nutrition/plans', () => ed.locator('button:has-text("Save plan")').click());
let cur = sec.locator('[data-testid="current-plan"]');
let txt = await cur.textContent();
ok(txt.includes('Pre-season') && txt.includes('2,500 kcal') && txt.includes('150 g protein') && txt.includes('Water 3 L'), 'plan saved with targets and a custom target');
ok(txt.includes('07:30 · Breakfast') && txt.includes('Oats, banana, milk') && txt.includes('Drink before you are thirsty.'), 'plan shows its meal recommendation and notes');

// ── Coach: meals of the day ──────────────────────────────────────────────
const day = sec.locator('[data-testid="meal-day"]');
await day.locator('button:has-text("Add a meal")').click();
let mf = day.locator('[data-testid="meal-form"]');
await mf.locator('input[aria-label="Time"]').fill('12:30');
ok((await mf.getByRole('radio', { name: 'Lunch' }).getAttribute('aria-checked')) === 'true', 'the meal category follows the time (12:30 → Lunch)');
await mf.locator('textarea[aria-label="What was eaten"]').fill('Chicken and rice');
await mf.locator('input[aria-label="Protein (g)"]').fill('30');
await mf.locator('input[aria-label="Carbs (g)"]').fill('50');
await mf.locator('input[aria-label="Fat (g)"]').fill('10');
ok((await mf.textContent()).includes('Calories will be calculated from the macros: 410 kcal'), 'the form shows calories calculated from the macros');
await mf.locator('input[aria-label="Water (L)"]').fill('0.5');
await act(coach, 'POST', `/api/players/${pid}/meals`, () => mf.locator('button:has-text("Add meal")').click());
let rows = day.locator('[data-testid="meal-row"]');
txt = await rows.first().textContent();
ok(txt.includes('Chicken and rice') && txt.includes('410 kcal') && txt.includes('P 30 g') && txt.includes('Water 0.5 L'), 'meal saved with calculated calories and the custom value');
ok((await day.locator('[data-testid="nutrition-meters"]').textContent()).includes('410 / 2,500 kcal'), 'daily total against the plan target');

await day.locator('button:has-text("Add a meal")').click();
mf = day.locator('[data-testid="meal-form"]');
await mf.locator('input[aria-label="Time"]').fill('20:00');
ok((await mf.getByRole('radio', { name: 'Dinner' }).getAttribute('aria-checked')) === 'true', '20:00 → Dinner');
await mf.locator('textarea[aria-label="What was eaten"]').fill('Pasta');
await mf.locator('input[aria-label="Calories (kcal)"]').fill('2300');
await mf.locator('input[type="file"]').setInputFiles(photo('dinner.png', [200, 80, 40]));
await mf.locator('img[alt="Meal photo"]').waitFor();
await act(coach, 'POST', `/api/players/${pid}/meals`, () => mf.locator('button:has-text("Add meal")').click());
const dinner = day.locator('[data-testid="meal-row"]', { hasText: 'Pasta' });
const dinnerImg = dinner.locator('img');
ok((await dinnerImg.count()) === 1, 'meal photo uploaded and shown');
const photoUrl = await dinnerImg.getAttribute('src');
ok(/\/player-assets\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/meals\/[0-9a-f-]{36}\.jpg$/.test(photoUrl ?? ''), 'photo stored in the player’s meals folder, shrunk to JPEG');
const meters = await day.locator('[data-testid="nutrition-meters"]').textContent();
ok(meters.includes('2,710 / 2,500 kcal') && meters.includes('+210'), 'over the target: the meter says by how much');
ok((await day.locator('[data-testid="nutrition-week"] button[aria-pressed="true"]').getAttribute('aria-label')).includes('2,710 kcal'), 'the 7-day strip shows today’s total');
await coach.screenshot({ path: `${SHOTS}/e-coach-day.png`, fullPage: true });

// Edit a meal, then delete one (its photo goes too)
await rows.first().locator('button[aria-label="Edit meal"]').click();
mf = day.locator('[data-testid="meal-form"]');
await mf.locator('textarea[aria-label="What was eaten"]').fill('Chicken, rice and salad');
await act(coach, 'PATCH', '/meals/', () => mf.locator('button:has-text("Save meal")').click());
ok((await day.textContent()).includes('Chicken, rice and salad'), 'meal edited');
await act(coach, 'DELETE', '/meals/', () => dinner.locator('button[aria-label="Delete meal"]').click());
ok((await day.locator('[data-testid="meal-row"]', { hasText: 'Pasta' }).count()) === 0, 'meal deleted');
const gone = await coach.evaluate(async (u) => (await fetch(u)).status, photoUrl);
ok(gone === 404, `the deleted meal’s photo is removed from storage (${gone})`);

// ── Coach: versions, duplicate, archive, delete ──────────────────────────
await cur.locator('button:has-text("New version")').click();
ed = sec.locator('[data-testid="plan-editor"]');
ok((await ed.locator('input[aria-label="Starts on"]').inputValue()) === tomorrow, 'a new version starts tomorrow by default (the plan started today)');
ok((await ed.textContent()).includes('stays in the history exactly as it is'), 'the editor explains what happens to the current plan');
await ed.locator('input[aria-label="Plan name"]').fill('Pre-season v2');
await ed.locator('input[aria-label="Calories (kcal)"]').fill('2700');
await act(coach, 'POST', '/nutrition/plans', () => ed.locator('button:has-text("Save plan")').click());
r = await api(coach, `/api/players/${pid}/nutrition`);
const v1 = r.body.plans.find((p) => p.title === 'Pre-season');
const v2 = r.body.plans.find((p) => p.title === 'Pre-season v2');
ok(v1?.ends_on === today && v1.targets.calories === 2500, 'the old version ends today, its targets unchanged');
ok(v2?.starts_on === tomorrow && v2.previous_id === v1?.id && v2.targets.calories === 2700, 'the new version starts tomorrow and points at the old one');
ok((await cur.textContent()).includes('Pre-season') && !(await cur.textContent()).includes('Pre-season v2'), 'today the old version is still the plan in force');
await sec.locator('button:has-text("other plans (1)")').click();
ok((await sec.locator('[data-testid="other-plans"]').textContent()).includes('Upcoming'), 'the new version is listed as Upcoming');

await cur.locator('button:has-text("Duplicate")').click();
ed = sec.locator('[data-testid="plan-editor"]');
ok((await ed.locator('input[aria-label="Plan name"]').inputValue()) === 'Pre-season (copy)', 'duplicate copies the plan as a draft');
await act(coach, 'POST', '/nutrition/plans', () => ed.locator('button:has-text("Save plan")').click());
const others = sec.locator('[data-testid="other-plans"]');
if (!(await others.count())) await sec.locator('button:has-text("other plans")').click();
const copy = others.locator('div', { hasText: 'Pre-season (copy)' }).last();
ok((await copy.textContent()).includes('Draft'), 'the copy is a draft');
await others.locator('button:has-text("Pre-season (copy)")').click();
await act(coach, 'PATCH', '/nutrition/plans/', () => others.locator('button:has-text("Archive")').click());
ok((await sec.locator('[data-testid="other-plans"]').textContent()).includes('Archived'), 'draft archived');
// The archived copy stays open after the reload; open it again only if it closed.
if (!(await sec.locator('[data-testid="other-plans"] button:has-text("Delete")').count())) await sec.locator('[data-testid="other-plans"] button:has-text("Pre-season (copy)")').click();
await act(coach, 'DELETE', '/nutrition/plans/', () => sec.locator('[data-testid="other-plans"] button:has-text("Delete")').click());
r = await api(coach, `/api/players/${pid}/nutrition`);
ok(r.body.plans.length === 2 && !r.body.plans.some((p) => p.title.includes('copy')), 'the archived copy is deleted; both versions remain');

// Server-side protections
const old = (await api(coach, `/api/players/${pid}/nutrition/plans`, { method: 'POST', body: JSON.stringify({ title: 'January', starts_on: '2026-01-01', ends_on: '2026-01-31', targets: { calories: 2400 } }) })).body.plan;
r = await api(coach, `/api/players/${pid}/nutrition/plans/${old.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'January edited', starts_on: '2026-01-01', ends_on: '2026-01-31', expected_updated_at: old.updated_at }) });
ok(r.status === 409, `a plan whose period has ended cannot be edited (${r.status})`);
r = await api(coach, `/api/players/${pid}/nutrition/plans/${old.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
ok(r.status === 200 && r.body.plan.status === 'archived', 'an ended plan can still be archived');
r = await api(coach, `/api/players/${pid}/nutrition/plans/${v1.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Stale', starts_on: v1.starts_on, expected_updated_at: '2000-01-01T00:00:00.000Z' }) });
ok(r.status === 409, `editing a stale copy of a plan is refused (${r.status})`);
r = await api(coach, `/api/players/${pid}/nutrition/plans`, { method: 'POST', body: JSON.stringify({ title: 'Bad version', starts_on: v1.starts_on, replaces: v1.id }) });
ok(r.status === 400, `a version cannot start on or before the plan it replaces (${r.status})`);
r = await api(coach, `/api/players/${pid}/meals`, { method: 'POST', body: JSON.stringify({ description: 'x', photo_url: 'https://evil.example/x.jpg' }) });
ok(r.status === 200 && r.body.meal.photo_url === null, 'a photo URL that is not one of ours is never stored');
await api(coach, `/api/players/${pid}/meals/${r.body.meal.id}`, { method: 'DELETE' });

// ── Player: the share link ───────────────────────────────────────────────
r = await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit' }) });
const link = r.body.share.url;
const token = link.split('/share/')[1];
ok(r.body.share.permissions.see.nutrition === true && r.body.share.permissions.add.meals === true, 'an edit link may see Nutrition and add meals by default');

const sctx = await contextFor(b, null, { mobile: true });
const sp = await sctx.newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(player)', e.message); failures++; });
sp.on('dialog', (d) => d.accept());
await sp.goto(link, { waitUntil: 'networkidle' });
const ssec = sp.locator('[data-testid="nutrition-section"]');
await ssec.locator('[data-testid="current-plan"]').waitFor();
txt = await ssec.textContent();
ok(txt.includes('Pre-season') && txt.includes('2,500 kcal') && txt.includes('Oats, banana, milk'), 'the player sees the plan in force, its targets and recommendations');
ok(!txt.includes('January'), 'archived plans are not shown to the player');
ok((await ssec.locator('button:has-text("Edit")').count()) === 0 && (await ssec.locator('button:has-text("New version")').count()) === 0, 'the player cannot change plans');
ok(txt.includes('Chicken, rice and salad'), 'the player sees the meals the coach logged');
ok((await ssec.locator('[data-testid="meal-row"]', { hasText: 'Chicken' }).locator('button[aria-label="Edit meal"]').count()) === 0, 'the player cannot edit a coach meal');

const sday = ssec.locator('[data-testid="meal-day"]');
await sday.locator('button:has-text("Add a meal")').click();
let smf = sday.locator('[data-testid="meal-form"]');
await smf.locator('input[aria-label="Time"]').fill('16:00');
await smf.locator('textarea[aria-label="What was eaten"]').fill('Banana and yoghurt');
await smf.locator('input[aria-label="Calories (kcal)"]').fill('250');
await smf.locator('input[type="file"]').setInputFiles(photo('snack.png', [240, 200, 60]));
await smf.locator('img[alt="Meal photo"]').waitFor();
await act(sp, 'POST', `/api/share/${token}/meals`, () => smf.locator('button:has-text("Add meal")').click());
let mine = sday.locator('[data-testid="meal-row"]', { hasText: 'Banana' });
txt = await mine.textContent();
ok(txt.includes('You') && txt.includes('Waiting for review') && (await mine.locator('img').count()) === 1, 'the player logged a meal with a photo; it waits for review');
await sp.screenshot({ path: `${SHOTS}/e-player-day.png`, fullPage: true });

const ref = '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b';
const d1 = await api(sp, `/api/share/${token}/meals`, { method: 'POST', body: JSON.stringify({ description: 'Water bottle', category: 'other', client_ref: ref }) });
const d2 = await api(sp, `/api/share/${token}/meals`, { method: 'POST', body: JSON.stringify({ description: 'Water bottle', category: 'other', client_ref: ref }) });
ok(d1.status === 200 && d2.body?.duplicate === true && d1.body.meal.id === d2.body.meal.id, 'a retried meal is saved once');
r = await api(sp, `/api/share/${token}/meals`, { method: 'POST', body: JSON.stringify({ description: 'x', photo_url: 'https://evil.example/x.jpg' }) });
ok(r.status === 200 && r.body.meal.photo_url === null, 'the player cannot point a meal at an outside picture');
const strayId = r.body.meal.id;
const coachMeal = (await api(coach, `/api/players/${pid}/nutrition`)).body.meals.find((m) => m.author === 'coach');
r = await api(sp, `/api/share/${token}/meals/${coachMeal.id}`, { method: 'PATCH', body: JSON.stringify({ description: 'hacked' }) });
ok(r.status === 403, `the player cannot change a coach meal (${r.status})`);
r = await api(sp, `/api/share/${token}/meals/${coachMeal.id}`, { method: 'DELETE' });
ok(r.status === 403, `the player cannot delete a coach meal (${r.status})`);

// ── Coach reviews ────────────────────────────────────────────────────────
await coach.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
const rq = coach.locator('[data-testid="review-meals"]');
ok((await rq.textContent()).includes('3 meals logged by the player'), 'the coach sees the player’s meals in To review');
await coach.locator('[data-testid="review-meals"] button:has-text("Review in Nutrition")').click();
await sec.waitFor();
const pmeal = sec.locator('[data-testid="meal-row"]', { hasText: 'Banana' });
await pmeal.locator('button:has-text("Ask for a fix")').click();
await pmeal.locator('input[aria-label="What should the player change?"]').fill('Add the protein, please');
await act(coach, 'PATCH', '/meals/', () => pmeal.locator('button:has-text("Send")').click());
ok((await pmeal.textContent()).includes('Needs a fix'), 'coach asked for a fix');

await sp.reload({ waitUntil: 'networkidle' });
await ssec.locator('[data-testid="current-plan"]').waitFor();
ok((await ssec.textContent()).includes('Your coach asked you to fix one meal'), 'the player sees the request');
mine = sday.locator('[data-testid="meal-row"]', { hasText: 'Banana' });
ok((await mine.textContent()).includes('Coach: Add the protein, please'), 'the player sees the coach’s note');
await mine.locator('button[aria-label="Edit meal"]').click();
smf = sday.locator('[data-testid="meal-form"]');
await smf.locator('input[aria-label="Protein (g)"]').fill('12');
await act(sp, 'PATCH', `/api/share/${token}/meals/`, () => smf.locator('button:has-text("Save meal")').click());
mine = sday.locator('[data-testid="meal-row"]', { hasText: 'Banana' });
txt = await mine.textContent();
ok(txt.includes('Waiting for review') && txt.includes('P 12 g') && (await mine.locator('img').count()) === 1, 'corrected meal goes back to review and keeps its photo');

await coach.reload({ waitUntil: 'networkidle' });
await act(coach, 'POST', '/meals/approve', () => sec.locator('button:has-text("Approve the 3 meals of this day")').click());
r = await api(coach, `/api/players/${pid}/review`);
ok((r.body.meals ?? []).length === 0, 'approving the day empties the review queue');
const banana = (await api(coach, `/api/players/${pid}/nutrition`)).body.meals.find((m) => m.description === 'Banana and yoghurt');
r = await api(sp, `/api/share/${token}/meals/${banana.id}`, { method: 'PATCH', body: JSON.stringify({ description: 'changed after approval' }) });
ok(r.status === 403, `an approved meal cannot be changed through the link (${r.status})`);
r = await api(sp, `/api/share/${token}/meals/${strayId}`, { method: 'DELETE' });
ok(r.status === 403, `an approved meal cannot be deleted through the link (${r.status})`);

// ── Permissions ──────────────────────────────────────────────────────────
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { add: { meals: false } } }) });
await sp.reload({ waitUntil: 'networkidle' });
await ssec.locator('[data-testid="current-plan"]').waitFor();
ok((await ssec.locator('button:has-text("Add a meal")').count()) === 0, 'meals off: no Add a meal');
r = await api(sp, `/api/share/${token}/meals`, { method: 'POST', body: JSON.stringify({ description: 'blocked' }) });
ok(r.status === 403, `meals off: the server refuses a meal (${r.status})`);
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { nutrition: false } } }) });
await sp.reload({ waitUntil: 'networkidle' });
ok((await sp.locator('[data-testid="nutrition-section"]').count()) === 0, 'Nutrition hidden: the section is not on the page');
r = await api(sp, `/api/share/${token}/nutrition`);
ok(r.status === 403, `Nutrition hidden: the server refuses to send it (${r.status})`);
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'view', permissions: { see: { nutrition: true }, add: { meals: true } } }) });
r = await api(sp, `/api/share/${token}/meals`, { method: 'POST', body: JSON.stringify({ description: 'view link' }) });
ok(r.status === 403, `a view-only link cannot add meals, whatever is stored (${r.status})`);
r = await api(sp, `/api/share/${token}/nutrition`);
ok(r.status === 200 && r.body.canLog === false && r.body.plans.length >= 1, 'a view-only link still shows the plan');

// Another player's meal cannot be reached through this link
const other = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Other Player' }) })).body.player.id;
const otherMeal = (await api(coach, `/api/players/${other}/meals`, { method: 'POST', body: JSON.stringify({ description: 'not yours' }) })).body.meal;
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { nutrition: true }, add: { meals: true } } }) });
r = await api(sp, `/api/share/${token}/meals/${otherMeal.id}`, { method: 'DELETE' });
ok(r.status === 404, `another player’s meal is not reachable through this link (${r.status})`);

await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall nutrition checks passed');
process.exit(failures ? 1 : 0);
