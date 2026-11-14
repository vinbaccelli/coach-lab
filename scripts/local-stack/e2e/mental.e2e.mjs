// Mental questionnaires, private assessments and the player's to-do (PR H). Phone viewport.
import { launch, contextFor, api, BASE } from '../browser.mjs';

const SHOTS = process.env.E2E_SHOTS || '/tmp/coachlab-local-stack/shots';
let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const waitFor = (p, method, part) => p.waitForResponse((r) => r.url().includes(part) && r.request().method() === method, { timeout: 180000 });
const ymd = (d) => d.toISOString().slice(0, 10);
const yesterday = ymd(new Date(Date.now() - 86400000));

const b = await launch();
const coach = await (await contextFor(b, 'coachA', { mobile: true })).newPage();
coach.on('pageerror', (e) => { console.log('PAGEERROR(coach)', e.message); failures++; });
coach.on('dialog', (d) => d.accept());
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Mia Mental E2E' }) })).body.player.id;
const templates = (await api(coach, '/api/questionnaire-templates')).body.templates;
const wellId = templates.find((t) => t.slug === 'weekly_wellness').id;
const assessId = templates.find((t) => t.slug === 'coach_mental_assessment').id;

// ── Coach: send a questionnaire (with a to-do) and fill a private assessment ─────
await coach.goto(`${BASE}/players/${pid}?tab=mental`, { waitUntil: 'networkidle' });
const sec = coach.locator('[data-testid="mental-section"]');
await sec.waitFor();
await sec.locator('button:has-text("Send a questionnaire")').click();
await sec.locator('[data-testid="send-questionnaire"] select[aria-label="Questionnaire"]').selectOption(wellId);
await Promise.all([waitFor(coach, 'POST', '/questionnaires'), sec.locator('[data-testid="send-questionnaire"] button:has-text("Send")').click()]);
await sec.locator('[data-testid="questionnaire"][data-kind="questionnaire"]').waitFor();
ok((await sec.locator('[data-testid="questionnaire"][data-kind="questionnaire"]').textContent()).includes('Weekly wellness check'), 'questionnaire sent');
await sec.locator('button:has-text("New assessment")').click();
await sec.locator('[data-testid="send-questionnaire"] select[aria-label="Questionnaire"]').selectOption(assessId);
await sec.locator('[data-testid="send-questionnaire"] button:has-text("Start")').click();
const qf = sec.locator('[data-testid="questionnaire-form"]');
await qf.waitFor();
await qf.locator('button[aria-label="Focus: 4"]').click();
await qf.locator('button[aria-label="Resilience after mistakes: 3"]').click();
await Promise.all([waitFor(coach, 'POST', '/questionnaire-responses'), qf.locator('button:has-text("Save")').click()]);
const assessCard = sec.locator('[data-testid="questionnaire"][data-kind="assessment"]');
await assessCard.locator('[data-testid="q-response"]').first().waitFor();
ok((await assessCard.textContent()).includes('Focus: 4 / 5') && (await assessCard.textContent()).includes('Private assessment'), 'private assessment filled in by the coach');
await coach.screenshot({ path: `${SHOTS}/h-coach-mental.png`, fullPage: true });

// ── Coach: a daily task, already overdue ────────────────────────────────────
await coach.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
const todo = coach.locator('[data-testid="todo-card"]');
await todo.waitFor();
ok((await todo.textContent()).includes('Answer: Weekly wellness check'), 'the questionnaire is in the player’s to-do');
await todo.locator('button:has-text("Task")').click();
await todo.locator('input[aria-label="Task"]').fill('Stretch 10 minutes');
await todo.locator('input[aria-label="Due date"]').fill(yesterday);
await todo.locator('select[aria-label="Repeat"]').selectOption('daily');
await Promise.all([waitFor(coach, 'POST', '/assignments'), todo.locator('[data-testid="todo-form"] button:has-text("Add")').click()]);
await todo.locator('[data-testid="todo-item"][data-state="overdue"]').waitFor();
ok((await todo.textContent()).includes('1 overdue'), 'the coach sees the overdue task');

// ── The player through the share link ──────────────────────────────────────
let r = await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit' }) });
const link = r.body.share.url;
const token = link.split('/share/')[1];
ok(r.body.share.permissions.see.mental === false && r.body.share.permissions.add.questionnaires === true, 'by default a link answers questionnaires but does not see Mental');
const sp = await (await contextFor(b, null, { mobile: true })).newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(player)', e.message); failures++; });
sp.on('dialog', (d) => d.accept());
await sp.goto(link, { waitUntil: 'networkidle' });
await sp.locator('[data-testid="todo-item"]').first().waitFor();
const states = await sp.locator('[data-testid="todo-item"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
ok(states.includes('overdue') && states.includes('no_date'), `the player sees the to-do (${states.join(',')})`);
await sp.locator('[data-testid="mental-section"]').waitFor();
ok((await sp.locator('[data-kind="assessment"]').count()) === 0 && !(await sp.content()).includes('Coach\'s mental assessment'), 'the assessment is not on the player’s page');
r = await api(sp, `/api/share/${token}/mental`);
ok(r.status === 200 && r.body.questionnaires.every((q) => q.kind === 'questionnaire') && r.body.questionnaires.length === 1, 'the server never sends the assessment');
const assessQ = (await api(coach, `/api/players/${pid}/mental`)).body.questionnaires.find((q) => q.kind === 'assessment');
r = await api(sp, `/api/share/${token}/questionnaire-responses`, { method: 'POST', body: JSON.stringify({ questionnaire_id: assessQ.id, answers: { focus: 5 } }) });
ok(r.status === 404, `the player cannot answer the coach's assessment (${r.status})`);

await sp.locator('[data-testid="mental-section"] button:has-text("Answer")').first().click();
const pf = sp.locator('[data-testid="questionnaire-form"]');
await pf.locator('button[aria-label="How well did you sleep?: 7"]').click();
await pf.locator('button[aria-label="Stress: 4"]').click();
await Promise.all([waitFor(sp, 'POST', '/questionnaire-responses'), pf.locator('button:has-text("Send to coach")').click()]);
await waitFor(sp, 'GET', '/todo');
await sp.waitForTimeout(800);
const openTodo = await sp.locator('[data-testid="todo-item"]').evaluateAll((els) => els.map((e) => e.textContent));
ok(openTodo.length === 1 && openTodo[0].includes('Stretch'), 'answering completes the questionnaire task');
const mtext = await sp.locator('[data-testid="mental-section"]').textContent();
ok(mtext.includes('Sent to your coach') && !mtext.includes('7 / 10'), 'the player sees that it was sent, not the answers (Mental hidden)');
await Promise.all([waitFor(sp, 'POST', '/todo/'), sp.locator('[data-testid="todo-item"]', { hasText: 'Stretch' }).locator('button:has-text("Done")').click()]);
await waitFor(sp, 'GET', '/todo');
await sp.waitForTimeout(800);
ok((await sp.locator('[data-testid="todo-item"]', { hasText: 'Stretch' }).getAttribute('data-state')) === 'today', 'a daily task done comes back for today');
await sp.screenshot({ path: `${SHOTS}/h-player.png`, fullPage: true });

// ── Coach reads the answers ────────────────────────────────────────────────
await coach.goto(`${BASE}/players/${pid}?tab=overview`, { waitUntil: 'networkidle' });
ok((await coach.locator('[data-testid="review-answers"]').textContent()).includes('One questionnaire answer to read'), 'the coach sees the answer in To review');
await coach.locator('[data-testid="review-answers"] button:has-text("Open Mental")').click();
const qcard = sec.locator('[data-testid="questionnaire"][data-kind="questionnaire"]');
await qcard.locator('button:has-text("Show answers")').click();
ok((await qcard.textContent()).includes('How well did you sleep?: 7 / 10'), 'the coach reads the answers');
await Promise.all([waitFor(coach, 'PATCH', '/questionnaire-responses/'), qcard.locator('button:has-text("Mark as read")').click()]);
const resp = (await api(coach, `/api/players/${pid}/mental`)).body.responses.find((x) => x.author === 'link');
ok(resp?.status === 'approved', 'marked as read');
r = await api(sp, `/api/share/${token}/questionnaire-responses/${resp.id}`, { method: 'PATCH', body: JSON.stringify({ answers: { sleep: 1 } }) });
ok(r.status === 403, `answers already read cannot be changed through the link (${r.status})`);

// ── Permissions ────────────────────────────────────────────────────────────
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { mental: true } } }) });
r = await api(sp, `/api/share/${token}/mental`);
ok(r.status === 200 && r.body.responses.some((x) => x.answers.sleep === 7), 'with Mental visible the player sees their own answers');
ok(!r.body.questionnaires.some((q) => q.kind === 'assessment'), 'and still never the assessment');
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'edit', permissions: { see: { mental: false }, add: { questionnaires: false } } }) });
r = await api(sp, `/api/share/${token}/mental`);
ok(r.status === 403, `neither seeing nor answering: the server sends nothing (${r.status})`);
r = await api(sp, `/api/share/${token}/questionnaire-responses`, { method: 'POST', body: JSON.stringify({ questionnaire_id: resp.questionnaire_id, answers: { sleep: 5 } }) });
ok(r.status === 403, `answering off: refused (${r.status})`);
await sp.reload({ waitUntil: 'networkidle' });
ok((await sp.locator('[data-testid="mental-section"]').count()) === 0, 'and the section is not on the page');
await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'view' }) });
const stretch = (await api(coach, `/api/players/${pid}/assignments`)).body.assignments.find((a) => a.status === 'open' && a.title === 'Stretch 10 minutes');
r = await api(sp, `/api/share/${token}/todo/${stretch.id}`, { method: 'POST', body: '{}' });
ok(r.status === 403, `a view-only link cannot tick tasks (${r.status})`);
r = await api(sp, `/api/share/${token}/todo`);
ok(r.status === 200 && r.body.canComplete === false, 'a view-only link still shows the to-do');

// ── Other coaches and built-in templates ─────────────────────────────────────
const coachB = await (await contextFor(b, 'coachB', { mobile: true })).newPage();
await coachB.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
r = await api(coachB, `/api/players/${pid}/mental`);
ok(r.status === 200 && r.body.questionnaires.length === 0 && r.body.responses.length === 0, 'another coach sees nothing of this player’s Mental');
r = await api(coachB, `/api/players/${pid}/assignments`);
ok(r.status === 200 && r.body.assignments.length === 0, 'nor their to-do');
r = await api(coach, `/api/questionnaire-templates/${wellId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Mine', questions: [{ label: 'x' }] }) });
ok(r.status === 404, `a built-in questionnaire cannot be changed (${r.status})`);

await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall mental checks passed');
process.exit(failures ? 1 : 0);
