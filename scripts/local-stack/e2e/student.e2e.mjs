// Workflow B (student participation + coach review) and D (share permissions, enforced on the server).
import { launch, contextFor, api, BASE } from '../browser.mjs';

const SHOTS = process.env.E2E_SHOTS || '/tmp/coachlab-local-stack/shots';
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
async function act(p, method, urlPart, fn) {
  const w = p.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === method, { timeout: 180000 });
  await fn();
  const res = await w;
  await p.waitForTimeout(250);
  return res;
}
/** fetch() from an anonymous page (the share link has no login). */
const anonApi = (p, path, init = {}) => api(p, path, init);

const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
coach.on('pageerror', (e) => { console.log('PAGEERROR(coach)', e.message); failures++; });
coach.on('dialog', (d) => d.accept());
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });

// Setup: a player with Biometrics and Squat, and a "can add" link with pictures switched off.
let r = await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Leo Student' }) });
const pid = r.body.player.id;
const bio = (await api(coach, `/api/players/${pid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'biometrics' }) })).body.tracker;
const squat = (await api(coach, `/api/players/${pid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'squat' }) })).body.tracker;
await api(coach, `/api/players/${pid}/trackers/${bio.id}/entries`, { method: 'POST', body: JSON.stringify({ entry_date: '2026-01-05', measurements: { height: 180, weight: 75 } }) });

await coach.goto(`${BASE}/players/${pid}`, { waitUntil: 'networkidle' });
await coach.selectOption('select:near(:text("What can the player do?"))', 'edit');
await coach.click('text=Choose what the player can see and add');
await coach.locator('label:has-text("Pictures") input').uncheck();
await act(coach, 'POST', '/share', () => coach.click('button:has-text("Create link")'));
r = await api(coach, `/api/players/${pid}/share`);
ok(r.body.share.permissions.add.pictures === false && r.body.share.permissions.add.fitness === true, 'coach saved granular permissions (pictures off, fitness on)');
const link = r.body.share.url;
const token = link.split('/share/')[1];

// ── Workflow B: the student logs ──────────────────────────────────────────
const sctx = await contextFor(b, null, { mobile: true });
const sp = await sctx.newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(student)', e.message); failures++; });
sp.on('dialog', (d) => d.accept());
await sp.goto(link, { waitUntil: 'networkidle' });
const sBio = sp.locator('[data-testid="tracker-Biometrics"]');
await sBio.locator('button:has-text("Add entry")').click();
await sBio.locator('input[aria-label="Weight"]').fill('74.2');
await act(sp, 'POST', '/tracker-entries', () => sBio.locator('button:has-text("Send to coach")').click());
let stxt = await sBio.textContent();
ok(stxt.includes('Weight 74.2 kg') && stxt.includes('Sent'), 'student sent a weight; it shows as Sent (waiting for review)');
ok(/BMI 22\.9/.test(stxt), 'BMI is calculated for the student entry too (74.2 kg at 180 cm)');

const sSq = sp.locator('[data-testid="tracker-Squat"]');
await sSq.locator('button:has-text("Add entry")').click();
await sSq.locator('input[aria-label="Reps"]').nth(0).fill('12');
await sSq.locator('input[aria-label="Weight"]').nth(0).fill('50');
await sSq.locator('button:has-text("Add set")').click();
await act(sp, 'POST', '/tracker-entries', () => sSq.locator('button:has-text("Send to coach")').click());
ok((await sSq.textContent()).includes('2 sets: 12 × 50 kg, 12 × 50 kg'), 'student logged a workout as sets');
ok((await sp.locator('button:has-text("Add picture")').count()) === 0, 'Add picture hidden when the coach switched pictures off');
const pic = await sp.evaluate(async (tk) => {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' }));
  return (await fetch(`/api/share/${tk}`, { method: 'POST', body: fd })).status;
}, token);
ok(pic === 403, `a picture is refused by the server when pictures are off (${pic})`);
await sp.fill('textarea[placeholder="Write a comment…"]', 'Felt strong today');
await act(sp, 'POST', `/api/share/${token}`, () => sp.click('button:has-text("Add comment")'));
await sp.screenshot({ path: `${SHOTS}/d-student.png`, fullPage: true });

// Duplicate submit through the link is saved once
const ref = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const d1 = await anonApi(sp, `/api/share/${token}/tracker-entries`, { method: 'POST', body: JSON.stringify({ tracker_id: bio.id, measurements: { weight: 74 }, client_ref: ref }) });
const d2 = await anonApi(sp, `/api/share/${token}/tracker-entries`, { method: 'POST', body: JSON.stringify({ tracker_id: bio.id, measurements: { weight: 74 }, client_ref: ref }) });
ok(d1.status === 200 && d2.body?.duplicate === true && d1.body.entry.id === d2.body.entry.id, 'a retried student submit is saved once');

// ── The coach reviews ─────────────────────────────────────────────────────
await coach.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
const queue = coach.locator('[data-testid="review-queue"]');
let qtxt = await queue.textContent();
ok(/To review\s*3/.test(qtxt) && qtxt.includes('Squat') && qtxt.includes('Biometrics'), `coach sees the 3 submissions in To review (${qtxt.match(/To review\s*\d+/)?.[0]})`);
ok((await coach.locator('[role="tab"]:has-text("Overview")').textContent()).includes('3'), 'the Overview tab shows the count');
await act(coach, 'PATCH', '/tracker-entries/', () => queue.locator('button:has-text("Approve")').first().click());
// Ask for a fix on the squat
const sqRow = queue.locator('div:has(> div > strong:has-text("Squat"))');
await sqRow.locator('button:has-text("Ask for a fix")').click();
await coach.fill('input[placeholder="What should the player change?"]', 'Second set was 10 reps, not 12');
await act(coach, 'PATCH', '/tracker-entries/', () => coach.click('button:has-text("Send")'));
r = await api(coach, `/api/players/${pid}/trackers`);
const sqEntry = r.body.entries.find((e) => e.tracker_id === squat.id);
ok(sqEntry.status === 'needs_revision' && sqEntry.review_note.includes('10 reps'), 'squat entry sent back with a note');

// ── The student corrects it ───────────────────────────────────────────────
await sp.reload({ waitUntil: 'networkidle' });
stxt = await sp.textContent('body');
ok(stxt.includes('Your coach asked you to fix one entry') && stxt.includes('Second set was 10 reps'), 'student sees the fix request and the note');
const sSq2 = sp.locator('[data-testid="tracker-Squat"]');
await sSq2.locator('[aria-label="Edit entry"]').click();
await sSq2.locator('input[aria-label="Reps"]').nth(1).fill('10');
await act(sp, 'PATCH', '/tracker-entries/', () => sSq2.locator('button:has-text("Save changes")').click());
r = await api(coach, `/api/players/${pid}/trackers`);
const fixed = r.body.entries.find((e) => e.id === sqEntry.id);
ok(fixed.status === 'submitted' && fixed.sets[1].reps === 10 && !fixed.review_note, 'corrected entry goes back to the coach (submitted, note cleared)');

// ── Workflow D: what the link may NOT do (server-side) ─────────────────────
const approved = r.body.entries.find((e) => e.author === 'link' && e.status === 'approved');
let x = await anonApi(sp, `/api/share/${token}/tracker-entries/${approved.id}`, { method: 'PATCH', body: JSON.stringify({ measurements: { weight: 1 } }) });
ok(x.status === 403, `an approved entry cannot be edited through the link (${x.status})`);
x = await anonApi(sp, `/api/share/${token}/tracker-entries/${approved.id}`, { method: 'DELETE' });
ok(x.status === 403, `an approved entry cannot be deleted through the link (${x.status})`);
const coachEntry = r.body.entries.find((e) => e.author === 'coach');
x = await anonApi(sp, `/api/share/${token}/tracker-entries/${coachEntry.id}`, { method: 'DELETE' });
ok(x.status === 403, `a coach entry cannot be deleted through the link (${x.status})`);
// A tracker of another player (coach B's) through this link
const ctxB = await contextFor(b, 'coachB');
const pb = await ctxB.newPage();
await pb.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const otherPid = (await api(pb, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Other coach player' }) })).body.player.id;
const otherTracker = (await api(pb, `/api/players/${otherPid}/trackers`, { method: 'POST', body: JSON.stringify({ preset: 'squat' }) })).body.tracker;
x = await anonApi(sp, `/api/share/${token}/tracker-entries`, { method: 'POST', body: JSON.stringify({ tracker_id: otherTracker.id, sets: [{ reps: 1 }] }) });
ok(x.status === 404, `a tracker of another player cannot be written through this link (${x.status})`);
x = await anonApi(sp, `/api/share/${token}/tracker-entries`, { method: 'POST', body: JSON.stringify({ tracker_id: bio.id, measurements: { bmi: 20 } }) });
ok(x.status === 400, 'a calculated field cannot be sent');

// Hide Fitness: its trackers disappear from the link and can no longer be written
await coach.goto(`${BASE}/players/${pid}`, { waitUntil: 'networkidle' });
await coach.click('text=Choose what the player can see and add');
await coach.locator('label:has-text("Fitness") input').first().uncheck();
await act(coach, 'POST', '/share', () => coach.click('button:has-text("Save settings")'));
x = await anonApi(sp, `/api/share/${token}`);
ok(!x.body.trackers.some((t) => t.category === 'fitness') && x.body.permissions.add.fitness === false, 'hidden section: fitness trackers are not sent to the link');
x = await anonApi(sp, `/api/share/${token}/tracker-entries`, { method: 'POST', body: JSON.stringify({ tracker_id: squat.id, sets: [{ reps: 5 }] }) });
ok(x.status === 403, `hidden section: writing fitness through the link is refused (${x.status})`);

// View-only link: nothing can be added, the page offers no Add entry
await coach.selectOption('select:near(:text("What can the player do?"))', 'view');
await act(coach, 'POST', '/share', () => coach.click('button:has-text("Save settings")'));
await sp.reload({ waitUntil: 'networkidle' });
ok((await sp.locator('button:has-text("Add entry")').count()) === 0 && (await sp.locator('textarea[placeholder="Write a comment…"]').count()) === 0, 'view-only link: no add controls');
x = await anonApi(sp, `/api/share/${token}/tracker-entries`, { method: 'POST', body: JSON.stringify({ tracker_id: bio.id, measurements: { weight: 70 } }) });
ok(x.status === 403, `view-only link: tracker entry refused by the server (${x.status})`);
x = await anonApi(sp, `/api/share/${token}`, { method: 'POST', body: JSON.stringify({ kind: 'note', body: 'hi' }) });
ok(x.status === 403, `view-only link: comment refused by the server (${x.status})`);
await sp.screenshot({ path: `${SHOTS}/d-viewonly.png`, fullPage: true });

await b.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
