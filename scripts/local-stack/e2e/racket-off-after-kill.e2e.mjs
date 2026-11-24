// A phone that was killed during Auto-detect (the marker is left behind) comes back with Racket detection switched off.
import { launch, contextFor, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const b = await launch();
const ctx = await contextFor(b, 'coachA');
// Run once before the page's own scripts: act like a phone, Racket detection turned on, and a kill marker left by the last run.
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('stroPhoneBudget', '1');
      localStorage.setItem('autoRacket', '1');
      sessionStorage.setItem('anglemotion:autodetect-in-progress', String(Date.now()));
    }
  } catch {}
});
const p = await ctx.newPage();
p.setDefaultTimeout(120000);
await p.goto(`${BASE}/analysis`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
const racket = await p.evaluate(() => localStorage.getItem('autoRacket'));
ok(racket === '0', `Racket detection was switched off after the kill (autoRacket = ${racket})`);
const text = await p.evaluate(() => document.body.innerText);
ok(/Racket detection .* switched off/i.test(text), 'the notice says so');
await b.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
