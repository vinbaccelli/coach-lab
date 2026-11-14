// Workouts (PR G): exercise library, templates, planning on dates / weekly series, logging what was
// done (planned and done kept apart), the player logging through the share link, review, permissions.
import { launch, contextFor, api, BASE } from '../browser.mjs';

const SHOTS = process.env.E2E_SHOTS || '/tmp/coachlab-local-stack/shots';
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
async function act(p, method, urlPart, fn) {
  const w = p.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === method, { timeout: 180000 });
  await fn();
  const res = await w;
  await p.waitForTimeout(500);
  return res;
}
const ymd = (d) => d.toISOString().slice(0, 10);
const today = ymd(new Date());
const addDays = (s, n) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000));
const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
coach.on('pageerror', (e) => { console.log('PAGEERROR(coach)', e.message); failures++; });
coach.on('dialog', (d) => d.accept());
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Wendy Workouts' }) })).body.player.id;
await coach.goto(`${BASE}/players/${pid}?tab=workouts`, { waitUntil: 'networkidle' });
const sec = coach.locator('[data-testid="workouts-section"]');
await sec.waitFor();

// ── A template from the library ───────────────────────────────────────────
await sec.locator('button:has-text("Templates")').click();
await sec.locator('[data-testid="templates"] button:has-text("New template")').click();
let ed = sec.locator('[data-testid="workout-editor"]');
await ed.locator('input[aria-label="Workout name"]').fill('Leg strength A');
await ed.locator('button:has-text("From the library")').click();
const picker = ed.locator('[data-testid="exercise-picker"]');
await picker.locator('[data-testid="exercise-option"]').first().waitFor();
ok((await picker.locator('[data-testid="exercise-option"]').count()) >= 30, 'the library lists the built-in exercises');
await picker.locator('input[aria-label="Search exercises"]').fill('goblet');
await picker.locator('button[aria-label="About Goblet squat"]').click();
ok((await picker.textContent()).includes('Hold the weight close to the chest'), 'an exercise shows its instructions');
await picker.locator('button[aria-label="Add Goblet squat"]').click();
await ed.locator('button:has-text("From the library")').click();
await ed.locator('[data-testid="exercise-picker"] input[aria-label="Search exercises"]').fill('plank');
await ed.locator('[data-testid="exercise-picker"] button[aria-label="Add Plank"]').click();
await ed.locator('input[aria-label="Goblet squat Reps"]').fill('12');
await ed.locator('input[aria-label="Goblet squat kg"]').fill('16');
await ed.locator('input[aria-label="Plank Time"]').fill('0:45');
await act(coach, 'POST', '/api/workout-templates', () => ed.locator('button:has-text("Save")').click());
ok((await sec.locator('[data-testid="templates"]').textContent()).includes('Leg strength A'), 'template saved');
await sec.locator('[data-testid="templates"] button:has-text("Done")').click();

// ── Plan it as a weekly series ────────────────────────────────────────────
await sec.locator('button:has-text("Plan a workout")').click();
const af = sec.locator('[data-testid="assign-form"]');
const tid = (await api(coach, '/api/workout-templates')).body.templates.find((t) => t.title === 'Leg strength A').id;
await af.locator('select[aria-label="Workout to plan"]').selectOption(tid);
await af.locator('input[aria-label="First date"]').fill(today);
await af.locator(`button[aria-pressed]:has-text("${DAY[dow(today)]}")`).click();
await af.locator(`button[aria-pressed]:has-text("${DAY[dow(addDays(today, 3))]}")`).click();
await af.locator('input[aria-label="Number of weeks"]').fill('2');
ok((await af.locator('[data-testid="assign-preview"]').textContent()).startsWith('4 workouts'), 'the preview shows 4 dates for 2 days a week over 2 weeks');
await act(coach, 'POST', `/api/players/${pid}/workouts`, () => af.locator('button:has-text("Plan 4 workouts")').click());
let coming = sec.locator('[data-testid="upcoming-workouts"] [data-testid="planned-workout"]');
ok((await coming.count()) === 4, `4 workouts coming up (${await coming.count()})`);
ok((await coming.first().getAttribute('data-state')) === 'today' && (await coming.first().textContent()).includes('Goblet squat3 × 12 × 16 kg, rest 1:00'), 'today’s workout shows its plan');

// A one-off workout built here with a custom exercise, planned yesterday (not done)
await sec.locator('button:has-text("Plan a workout")').click();
await sec.locator('[data-testid="assign-form"] select[aria-label="Workout to plan"]').selectOption('new');
ed = sec.locator('[data-testid="workout-editor"]');
await ed.locator('input[aria-label="Workout name"]').fill('Court footwork');
await ed.locator('button:has-text("From the library")').click();
await ed.locator('[data-testid="exercise-picker"] button:has-text("New exercise")').click();
const ne = ed.locator('[data-testid="new-exercise"]');
await ne.locator('input[aria-label="Exercise name"]').fill('Crossover step drill');
await ne.locator('select[aria-label="Exercise category"]').selectOption('tennis');
await ne.locator('label:has-text("Weight (kg)") input').uncheck();
await act(coach, 'POST', '/api/exercises', () => ne.locator('button:has-text("Save and add")').click());
ok((await ed.locator('[data-testid="workout-item"]').textContent()).includes('Crossover step drill'), 'a custom exercise is created and added');
await ed.locator('button:has-text("Next: choose the dates")').click();
await sec.locator('[data-testid="assign-form"] input[aria-label="First date"]').fill(addDays(today, -1));
await act(coach, 'POST', `/api/players/${pid}/workouts`, () => sec.locator('[data-testid="assign-form"] button:has-text("Plan it")').click());
ok((await sec.locator('[data-testid="past-workouts"] [data-state="missed"]').count()) === 1, 'yesterday’s workout shows as not done');

// ── Log today's workout (planned and done kept apart) ─────────────────────
await coming.first().locator('button:has-text("Log it")').click();
const lf = sec.locator('[data-testid="log-form"]');
ok((await lf.locator('input[aria-label="Goblet squat set 1 reps"]').inputValue()) === '12', 'the log is prefilled from the plan');
await lf.locator('button[aria-label="Remove set 3 of Plank"]').click();
await lf.locator('select[aria-label="Effort from 1 to 10"]').selectOption('7');
await act(coach, 'POST', `/api/players/${pid}/workout-logs`, () => lf.locator('button:has-text("Save")').click());
const doneCard = sec.locator('[data-testid="past-workouts"] [data-state="done"]').first();
let txt = await doneCard.textContent();
ok(txt.includes('3 × 12 × 16 kg') && txt.includes('2 × 0:45 (part)') && txt.includes('effort 7/10'), 'planned against done: squat done, plank partial');
await coach.screenshot({ path: `${SHOTS}/g-coach-workouts.png`, fullPage: true });

let r = await api(coach, `/api/players/${pid}/workouts`);
const all = r.body.workouts;
const todays = all.find((w) => w.scheduled_on === today && w.title === 'Leg strength A');
r = await api(coach, `/api/players/${pid}/workouts/${todays.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Changed', items: [] }) });
ok(r.status === 409, `the plan of a done workout cannot be changed (${r.status})`);
r = await api(coach, `/api/players/${pid}/workout-logs`, { method: 'POST', body: JSON.stringify({ workout_id: todays.id, notes: 'again' }) });
ok(r.status === 409, `a planned workout gets one log (${r.status})`);

// Template edits never change planned workouts
const tpl = (await api(coach, '/api/workout-templates')).body.templates.find((t) => t.id === tid);
await api(coach, `/api/workout-templates/${tid}`, { method: 'PATCH', body: JSON.stringify({ title: tpl.title, notes: '', items: tpl.items.map((i) => ({ ...i, reps: i.reps ? 8 : i.reps })), expected_updated_at: tpl.updated_at }) });
r = await api(coach, `/api/players/${pid}/workouts`);
ok(r.body.workouts.filter((w) => w.title === 'Leg strength A').every((w) => w.items[0].reps === 12), 'editing the template does not change planned workouts');

// Skip, plan again, move; delete this and later of the series (the done one stays)
const upcomingIds = r.body.workouts.filter((w) => w.title === 'Leg strength A' && w.scheduled_on > today).map((w) => w.id);
r = await api(coach, `/api/players/${pid}/workouts/${upcomingIds[0]}`, { method: 'PATCH', body: JSON.stringify({ status: 'skipped' }) });
ok(r.status === 200 && r.body.workout.status === 'skipped', 'a workout can be skipped');
r = await api(coach, `/api/players/${pid}/workouts/${upcomingIds[0]}`, { method: 'PATCH', body: JSON.stringify({ scheduled_on: addDays(today, 1) }) });
ok(r.status === 200 && r.body.workout.scheduled_on === addDays(today, 1), 'a workout can be moved');
r = await api(coach, `/api/players/${pid}/workouts/${upcomingIds[1]}?series=future`, { method: 'DELETE' });
ok(r.status === 200 && r.body.removed.length === 2, `"delete this and later" removes the later undone ones (${r.body.removed?.length})`);
r = await api(coach, `/api/players/${pid}/workouts/${todays.id}`, { method: 'DELETE' });
ok(r.status === 409, `a done workout cannot be deleted while it has a log (${r.status})`);

// Library rights
const globalId = (await api(coach, '/api/exercises')).body.exercises.find((e) => e.slug === 'plank').id;
r = await api(coach, `/api/exercises/${globalId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Mine now' }) });
ok(r.status === 404, `a built-in exercise cannot be changed (${r.status})`);
const coachB = await (await contextFor(b, 'coachB', { mobile: true })).newPage();
await coachB.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
r = await api(coachB, '/api/exercises');
ok(r.status === 200 && r.body.exercises.some((e) => e.slug === 'plank') && !r.body.exercises.some((e) => e.name === 'Crossover step drill'), 'another coach sees the built-in library, not my exercises');
r = await api(coachB, `/api/players/${pid}/workouts`);
ok(r.status === 200 && r.body.workouts.length === 0, 'another coach sees none of this player’s workouts');

// ── The player through the share link ────────────────────────────────────
r = await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit' }) });
const link = r.body.share.url;
const token = link.split('/share/')[1];
ok(r.body.share.permissions.see.workouts && r.body.share.permissions.add.workouts, 'an edit link may see and log workouts by default');
const sp = await (await contextFor(b, null, { mobile: true })).newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(player)', e.message); failures++; });
sp.on('dialog', (d) => d.accept());
await sp.goto(link, { waitUntil: 'networkidle' });
const ssec = sp.locator('[data-testid="workouts-section"]');
await ssec.locator('[data-testid="upcoming-workouts"]').waitFor();
ok((await ssec.locator('button:has-text("Plan a workout")').count()) === 0 && (await ssec.locator('button:has-text("Edit")').count()) === 0, 'the player cannot plan or change plans');
const next = ssec.locator('[data-testid="upcoming-workouts"] [data-testid="planned-workout"]').first();
await next.locator('button:has-text("I did it")').click();
const slf = ssec.locator('[data-testid="log-form"]');
await slf.locator('input[aria-label="Goblet squat set 3 reps"]').fill('9');
await act(sp, 'POST', `/api/share/${token}/workout-logs`, () => slf.locator('button:has-text("Send to coach")').click());
let mine = ssec.locator('[data-testid="past-workouts"] [data-testid="planned-workout"][data-state="done"]', { hasText: 'Waiting for review' });
ok((await mine.count()) === 1 && (await mine.textContent()).includes('12 × 16 kg, 12 × 16 kg, 9 × 16 kg'), 'the player logged it; it waits for review');
await sp.screenshot({ path: `${SHOTS}/g-player-workouts.png`, fullPage: true });
const ref = '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';
const d1 = await api(sp, `/api/share/${token}/workout-logs`, { method: 'POST', body: JSON.stringify({ title: 'Jog', duration_min: 20, client_ref: ref }) });
const d2 = await api(sp, `/api/share/${token}/workout-logs`, { method: 'POST', body: JSON.stringify({ title: 'Jog', duration_min: 20, client_ref: ref }) });
ok(d1.status === 200 && d2.body?.duplicate === true && d1.body.log.id === d2.body.log.id, 'a retried log is saved once');

// Coach review: ask for a fix, the player corrects, the coach approves
await coach.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
ok((await coach.locator('[data-testid="review-workouts"]').textContent()).includes('2 workouts logged by the player'), 'the coach sees the player’s logs in To review');
await coach.locator('[data-testid="review-workouts"] button:has-text("Review in Workouts")').click();
const plog = sec.locator('[data-testid="planned-workout"]', { hasText: 'Logged by the player' }).first();
await plog.locator('button:has-text("Ask for a fix")').click();
await plog.locator('input[aria-label="What should the player change?"]').fill('Add your effort, please');
await act(coach, 'PATCH', '/workout-logs/', () => plog.locator('button:has-text("Send")').click());
await sp.reload({ waitUntil: 'networkidle' });
await ssec.locator('[data-testid="upcoming-workouts"]').waitFor();
ok((await ssec.textContent()).includes('Your coach asked you to fix one workout log') && (await ssec.textContent()).includes('Coach: Add your effort, please'), 'the player sees the request and the note');
await ssec.locator('[data-testid="planned-workout"]', { hasText: 'Needs a fix' }).locator('button:has-text("Edit log")').click();
await ssec.locator('[data-testid="log-form"] select[aria-label="Effort from 1 to 10"]').selectOption('8');
await act(sp, 'PATCH', `/api/share/${token}/workout-logs/`, () => ssec.locator('[data-testid="log-form"] button:has-text("Send the correction")').click());
ok((await ssec.locator('[data-testid="planned-workout"]', { hasText: 'effort 8/10' }).textContent()).includes('Waiting for review'), 'the correction goes back to the coach');
await coach.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
await act(coach, 'POST', '/workout-logs/approve', () => coach.locator('[data-testid="review-workouts"] button:has-text("Approve all 2")').click());
const approved = (await api(coach, `/api/players/${pid}/workouts`)).body.logs.find((l) => l.author === 'link' && l.workout_id);
r = await api(sp, `/api/share/${token}/workout-logs/${approved.id}`, { method: 'PATCH', body: JSON.stringify({ notes: 'changed later' }) });
ok(r.status === 403, `an approved log cannot be changed through the link (${r.status})`);
const coachLog = (await api(coach, `/api/players/${pid}/workouts`)).body.logs.find((l) => l.author === 'coach');
r = await api(sp, `/api/share/${token}/workout-logs/${coachLog.id}`, { method: 'DELETE' });
ok(r.status === 403, `the coach's log cannot be deleted through the link (${r.status})`);

// Permissions
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { add: { workouts: false } } }) });
await sp.reload({ waitUntil: 'networkidle' });
await ssec.locator('[data-testid="upcoming-workouts"]').waitFor();
ok((await ssec.locator('button:has-text("I did it")').count()) === 0, 'logging off: no "I did it"');
r = await api(sp, `/api/share/${token}/workout-logs`, { method: 'POST', body: JSON.stringify({ notes: 'blocked' }) });
ok(r.status === 403, `logging off: the server refuses (${r.status})`);
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { workouts: false } } }) });
await sp.reload({ waitUntil: 'networkidle' });
ok((await sp.locator('[data-testid="workouts-section"]').count()) === 0, 'Workouts hidden: no section');
r = await api(sp, `/api/share/${token}/workouts`);
ok(r.status === 403, `Workouts hidden: the server refuses to send them (${r.status})`);
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'view', permissions: { see: { workouts: true }, add: { workouts: true } } }) });
r = await api(sp, `/api/share/${token}/workout-logs`, { method: 'POST', body: JSON.stringify({ notes: 'view link' }) });
ok(r.status === 403, `a view-only link cannot log, whatever is stored (${r.status})`);
const other = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Other Workouts' }) })).body.player.id;
const otherLog = (await api(coach, `/api/players/${other}/workout-logs`, { method: 'POST', body: JSON.stringify({ notes: 'not yours' }) })).body.log;
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { workouts: true }, add: { workouts: true } } }) });
r = await api(sp, `/api/share/${token}/workout-logs/${otherLog.id}`, { method: 'DELETE' });
ok(r.status === 404, `another player's log is not reachable through this link (${r.status})`);

await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall workouts checks passed');
process.exit(failures ? 1 : 0);
