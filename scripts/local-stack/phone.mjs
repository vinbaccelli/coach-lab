// Shared by the phone-sized e2e checks: an iPhone-sized touch session on /analysis with a small VP9 clip loaded.
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { launch, contextFor, BASE } from './browser.mjs';

export async function phoneSession({ coach = 'coachA' } = {}) {
  const clip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phone-')), 'clip.webm');
  execSync(`ffmpeg -loglevel error -y -f lavfi -i testsrc=size=640x360:rate=15 -t 3 -c:v libvpx-vp9 -b:v 300k ${clip}`);
  const b = await launch();
  const ctx = await contextFor(b, coach, { context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(120000);
  const cdp = await ctx.newCDPSession(p);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([id, x, y]) => ({ id, x, y })) });
  await p.goto(`${BASE}/analysis`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.getByText('Skip for now').first().click({ timeout: 4000 }).catch(() => {});
  await p.getByText('Not now').first().click({ timeout: 2000 }).catch(() => {});
  await p.locator('input[type=file]').first().setInputFiles(clip);
  await p.waitForTimeout(6000);
  const drag = async (from, to) => {
    await send('touchStart', [[1, ...from]]); await p.waitForTimeout(60);
    for (let k = 1; k <= 10; k++) { await send('touchMove', [[1, from[0] + ((to[0] - from[0]) * k) / 10, from[1] + ((to[1] - from[1]) * k) / 10]]); await p.waitForTimeout(25); }
    await send('touchEnd', [[1, ...to]]); await p.waitForTimeout(500);
  };
  return { b, p, send, drag };
}
