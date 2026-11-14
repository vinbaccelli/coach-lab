// A YouTube video in the timeline must render on the coach profile and on the share link.
// The site sends `Cross-Origin-Embedder-Policy: credentialless` (next.config.js); Chromium then blanks
// a cross-origin frame that sends no COEP header of its own — YouTube's embed does not — unless the
// frame carries the `credentialless` attribute (KNOWN_ISSUES 080: empty grey boxes on phones).
// YouTube is not reachable from the test machine, so the embed is answered by a stub that, like
// YouTube, sends no COEP header: the frame shows the stub's text only if the browser lets it load.
import { launch, contextFor, api, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const VID = 'dQw4w9WgXcQ';
const stubYoutube = (ctx) => ctx.route('https://www.youtube-nocookie.com/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<p id="stub">youtube player</p>' }));

/** Text inside the first timeline video frame ('' when the browser blocked it). */
async function frameText(p) {
  const el = p.locator('[data-testid="history-feed"] iframe').first();
  await el.waitFor();
  await p.waitForTimeout(1500);
  const f = await (await el.elementHandle()).contentFrame();
  try { return (await f.evaluate(() => document.body?.innerText ?? '')).trim(); } catch { return ''; }
}

const b = await launch();
const cctx = await contextFor(b, 'coachA', { mobile: true });
await stubYoutube(cctx);
const coach = await cctx.newPage();
coach.on('pageerror', (e) => { console.log('PAGEERROR(coach)', e.message); failures++; });
await coach.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(coach, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Vic Video' }) })).body.player.id;
const r = await api(coach, `/api/players/${pid}/timeline`, { method: 'POST', body: JSON.stringify({ kind: 'video', youtube_url: `https://youtu.be/${VID}` }) });
ok(r.status === 200 || r.status === 201, `video added to the timeline (${r.status})`);

await coach.goto(`${BASE}/players/${pid}?tab=timeline`, { waitUntil: 'networkidle' });
ok((await frameText(coach)) === 'youtube player', 'coach profile: the timeline video loads (not a blank box)');
ok((await coach.locator(`[data-testid="history-feed"] a[href="https://www.youtube.com/watch?v=${VID}"]`).count()) === 1, 'coach profile: a "Watch on YouTube" link is always there');

const share = await api(coach, `/api/players/${pid}/share`, { method: 'POST', body: JSON.stringify({ mode: 'view' }) });
const sctx = await contextFor(b, null, { mobile: true });
await stubYoutube(sctx);
const sp = await sctx.newPage();
sp.on('pageerror', (e) => { console.log('PAGEERROR(player)', e.message); failures++; });
await sp.goto(share.body.share.url, { waitUntil: 'networkidle' });
ok((await frameText(sp)) === 'youtube player', 'share link: the timeline video loads (not a blank box)');
ok((await sp.locator(`[data-testid="history-feed"] a[href="https://www.youtube.com/watch?v=${VID}"]`).count()) === 1, 'share link: a "Watch on YouTube" link is always there');

await b.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall video embed checks passed');
process.exit(failures ? 1 : 0);
