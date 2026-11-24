// A video uploading to YouTube keeps going while the coach leaves the player page (client-side navigation) and is
// added to the timeline when it finishes. YouTube itself is mocked (no credentials, no network).
import { launch, contextFor, api, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const b = await launch();
const ctx = await contextFor(b, 'coachA');
const p = await ctx.newPage();
p.setDefaultTimeout(120000);
p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT, OPTIONS', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'Range' };
let putAt = 0;
await ctx.route('**/api/youtube/upload-session', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploadUrl: 'https://upload.test/session-1' }) }));
await ctx.route('https://upload.test/**', async (r) => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
  putAt = Date.now();
  await new Promise((res) => setTimeout(res, 3500)); // the upload takes a few seconds
  return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'dQw4w9WgXcQ' }) });
});
let timelinePost = null;
p.on('request', (req) => { if (req.method() === 'POST' && /\/api\/players\/[^/]+\/timeline$/.test(req.url())) timelinePost = req.postData(); });

await p.goto(`${BASE}/players`, { waitUntil: 'domcontentloaded' });
const pid = (await api(p, '/api/players', { method: 'POST', body: JSON.stringify({ display_name: 'Una Upload' }) })).body.player.id;
await p.goto(`${BASE}/players/${pid}`, { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /Upload video to YouTube/ }).waitFor();
await p.waitForTimeout(1500);
await p.locator('input[type=file][accept="video/*"]').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(200_000, 1) });

await p.locator('[data-testid="upload-tray"]').waitFor();
ok(true, 'the tray appears on the player page');

// Leave the page WITHOUT a reload (what the app's own links do).
const left = await p.evaluate(() => { const a = document.querySelector('a[href="/analysis"]'); if (a) { a.click(); return 'link'; } if (window.next?.router) { window.next.router.push('/analysis'); return 'router'; } return null; });
ok(!!left, `left the page without reloading (${left})`);
await p.waitForURL(/\/analysis/);
await p.locator('[data-testid="upload-tray"]').waitFor();
const text1 = await p.locator('[data-testid="upload-tray"]').innerText();
ok(/Uploading to YouTube/.test(text1) || /Adding it/.test(text1), `on the analysis page the tray still shows the upload (${text1.replace(/\n/g, ' | ')})`);
const prevented = await p.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
ok(prevented, 'closing the tab while it uploads asks first');

// It finishes and is added to the timeline although we are not on that page.
await p.waitForFunction(() => /Uploaded and added/.test(document.querySelector('[data-testid="upload-tray"]')?.innerText ?? ''), null, { timeout: 60000 });
ok(timelinePost && timelinePost.includes('dQw4w9WgXcQ') && timelinePost.includes('"video"'), `the video was added to the player's timeline (${timelinePost})`);
const items = (await api(p, `/api/players/${pid}/history`)).body?.items ?? [];
ok(items.some((i) => JSON.stringify(i).includes('dQw4w9WgXcQ')), 'and the timeline now lists it');
await p.waitForFunction(() => !document.querySelector('[data-testid="upload-tray"]'), null, { timeout: 15000 });
ok(true, 'the tray clears itself after a few seconds');
const after = await p.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
ok(!after, 'and no longer blocks closing the tab');

await b.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
