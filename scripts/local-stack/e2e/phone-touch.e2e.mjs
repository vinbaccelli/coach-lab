// Phone-sized touch checks on /analysis: the expanded toolbar's width, and precision drawing with the
// two-finger gesture (anchor finger aims, second finger taps to start / end). Reads the real strokes
// from the Canvas handle. Needs ffmpeg (makes a tiny VP9 clip: Chromium cannot decode H.264).
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { launch, contextFor, BASE } from '../browser.mjs';

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) failures++; };
const clip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phone-touch-')), 'clip.webm');
execSync(`ffmpeg -loglevel error -y -f lavfi -i testsrc=size=640x360:rate=15 -t 3 -c:v libvpx-vp9 -b:v 300k ${clip}`);

const b = await launch();
const ctx = await contextFor(b, 'coachA', { context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } });
const p = await ctx.newPage();
p.setDefaultTimeout(120000);
p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
const cdp = await ctx.newCDPSession(p);
const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([id, x, y]) => ({ id, x, y })) });
const strokes = () => p.evaluate(() => {
  for (const c of document.querySelectorAll('canvas')) {
    const k = Object.keys(c).find((x) => x.startsWith('__reactFiber$'));
    for (let f = k ? c[k] : null; f; f = f.return) {
      const r = f.ref;
      if (r && r.current && typeof r.current.exportStrokes === 'function') return JSON.parse(r.current.exportStrokes());
    }
  }
  return null;
});

await p.goto(`${BASE}/analysis`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
await p.getByText('Skip for now').first().click({ timeout: 4000 }).catch(() => {});
await p.getByText('Not now').first().click({ timeout: 2000 }).catch(() => {});
await p.locator('input[type=file]').first().setInputFiles(clip);
await p.waitForTimeout(6000);

// 1. Expanded toolbar: labels fit.
await p.locator('button[aria-label="Expand toolbar labels"]').tap();
await p.waitForTimeout(1500);
const w = await p.locator('button', { hasText: /^Select$/ }).first().evaluate((e) => e.getBoundingClientRect().width);
ok(w >= 150, `the expanded phone toolbar opens wide enough for its labels (button ${Math.round(w)} px)`);
await p.locator('button[aria-label="Collapse toolbar labels"]').tap();
await p.waitForTimeout(800);

// 2. Precision drawing.
await p.locator('button[aria-label="Metrics"]').tap(); await p.waitForTimeout(1200);
await p.locator('button[aria-label="Draw"]').first().tap(); await p.waitForTimeout(1200);
await p.mouse.click(350, 500).catch(() => {});
async function precisionStroke(tool) {
  await p.locator(`button[aria-label="${tool}"]`).tap(); await p.waitForTimeout(400);
  await p.locator('button[aria-label="Precision"]').tap(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Got it', exact: true }).first().tap().catch(() => {});
  await p.waitForTimeout(400);
  const before = (await strokes()).length;
  await send('touchStart', [[1, 150, 540]]);
  for (let i = 1; i <= 4; i++) { await send('touchMove', [[1, 150 + i * 10, 540]]); await p.waitForTimeout(40); }
  await send('touchStart', [[1, 190, 540], [2, 320, 250]]); await p.waitForTimeout(60); await send('touchEnd', [[2, 320, 250]]); await p.waitForTimeout(150);
  for (let i = 1; i <= 6; i++) { await send('touchMove', [[1, 190 + i * 10, 540 - i * 6]]); await p.waitForTimeout(40); }
  await send('touchStart', [[1, 250, 504], [2, 320, 250]]); await p.waitForTimeout(60); await send('touchEnd', [[2, 320, 250]]); await p.waitForTimeout(150);
  await send('touchEnd', [[1, 250, 504]]); await p.waitForTimeout(500);
  const after = await strokes();
  await p.locator('button[aria-label="Precision"]').tap(); await p.waitForTimeout(500); // switch precision off again
  return after.slice(before);
}
const pen = await precisionStroke('Pen');
ok(pen.length === 1 && pen[0].tool === 'pen' && pen[0].pts.length >= 6, `precision + pen draws ONE freehand line between the two taps (${pen.length} stroke, ${pen[0]?.pts?.length} points)`);
const line = await precisionStroke('Line');
ok(line.length === 1 && Math.hypot(line[0].p2.x - line[0].p1.x, line[0].p2.y - line[0].p1.y) > 20, `precision + line draws ONE line from the first tap to the second (${line.length} stroke)`);

await b.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
