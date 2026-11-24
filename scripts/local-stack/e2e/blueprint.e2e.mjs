// Blueprint tab (the eBook's variants) + the Technical tab's fundamentals check against it.
import { launch, contextFor, api, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const b = await launch();

async function run(coachKey, label) {
  const coach = await (await contextFor(b, coachKey)).newPage();
  coach.setDefaultTimeout(120000);
  coach.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
  await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
  const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: `Bea Blueprint ${label}` }) })).body.player.id;

  await coach.goto(`${BASE}/players/${pid}?tab=blueprint`, { waitUntil: 'domcontentloaded' });
  await coach.locator('[data-testid="blueprint-tab"]').waitFor();
  const tabs = (await coach.locator('nav[aria-label="Player sections"] [role="tab"]').allTextContents()).map((t) => t.replace(/\d+$/, '').trim());
  ok(tabs.includes('Blueprint') && tabs.indexOf('Blueprint') === tabs.indexOf('Technical') + 1, `${label}: Blueprint tab sits right after Technical (${tabs.join(', ')})`);

  // choose the racket drop style for the forehand
  await coach.getByRole('radio', { name: /Edge-down \(del Potro approach\)/ }).first().check();
  await coach.waitForTimeout(1200);
  let saved = (await api(coach, `/api/players/${pid}`)).body.player.blueprint;
  ok(saved?.choices?.forehand?.['drop-style']?.option === 'edge-down-del-potro-approach', `${label}: the choice is saved on the player`);

  // the technical tab: 20 book checkpoints + 1 execution check for the choice
  await coach.goto(`${BASE}/players/${pid}?tab=technical`, { waitUntil: 'domcontentloaded' });
  await coach.locator('[data-testid="blueprint-checks"]').waitFor();
  ok((await coach.locator('[data-check]').count()) === 21, `${label}: 20 fundamentals + 1 check for the chosen variant`);
  ok((await coach.locator('[data-check^="exec."]').count()) === 1, `${label}: the chosen-variant check is there`);
  ok(/0 of 21 checked/.test(await coach.locator('[data-testid="blueprint-checks"]').innerText()), `${label}: progress starts at 0 of 21`);

  // mark a book fault and the execution check
  await coach.locator('[data-check="g4-wrist"]').getByRole('button', { name: 'Rigid' }).click();
  await coach.locator('[data-check^="exec."]').getByRole('button', { name: 'Partly' }).click();
  await coach.waitForTimeout(1200);
  ok(/2 of 21 checked · 2 to work on/.test(await coach.locator('[data-testid="blueprint-checks"]').innerText()), `${label}: progress and faults update`);
  saved = (await api(coach, `/api/players/${pid}`)).body.player.blueprint;
  ok(saved?.checks?.forehand?.['g4-wrist']?.answer === 'Rigid', `${label}: the mark is saved`);
  ok(saved?.checks?.forehand?.['exec.forehand.drop-style']?.against === 'edge-down-del-potro-approach', `${label}: the execution mark remembers the option it was made against`);

  // it survives a reload
  await coach.reload({ waitUntil: 'domcontentloaded' });
  await coach.locator('[data-testid="blueprint-checks"]').waitFor();
  ok(/2 of 21 checked/.test(await coach.locator('[data-testid="blueprint-checks"]').innerText()), `${label}: still there after a reload`);

  // the server refuses junk
  const junk = await api(coach, `/api/players/${pid}`, { method: 'PATCH', body: JSON.stringify({ blueprint: { choices: { forehand: { grip: { option: 'nope' } } }, checks: { forehand: { x: { answer: 'Yes', date: '2026-11-19' } } } } }) });
  const after = (await api(coach, `/api/players/${pid}`)).body.player.blueprint;
  ok(junk.status === 200 && JSON.stringify(after) === '{"v":"ebook-1","checks":{},"choices":{}}', `${label}: the server cleans a bad blueprint (nothing invalid is kept)`);
}

await run('coachA', 'Pro');
await run('coachLight', 'Light'); // Light and Pro both (Vin, 2026-11-19)
await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall blueprint checks passed');
process.exit(failures ? 1 : 0);
